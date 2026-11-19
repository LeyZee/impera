import '@impera/design-system/styles.css';
import './popup.css';

import type { PlatformAccountId } from '@impera/contracts';
import { browser } from 'wxt/browser';

import {
  crmOriginOf,
  DEFAULT_CRM_ADDRESS,
  isGrantedAtInstall,
  permissionPatternOf,
  shortAddress,
} from '../../lib/crm-address';
import { ADDRESS_KEY, savedOrigin } from '../../lib/crm-origin-store';
import { readCrmSession } from '../../lib/session';
import { placeOf } from '../../lib/tab';
import {
  LinkSavedSchema,
  LinkStateSchema,
  MarkableCreatorsSchema,
  MarkedSchema,
  RevealAccountsSchema,
  RevealReadSchema,
  RevealSyncedSchema,
  WatchStatusSchema,
  type FromPopup,
  type MarkableCreators,
} from '../../lib/watch/protocol';
import { INSTAGRAM_PATTERN } from '../../lib/watch/watch-script';
import { awayOf, kindOf, watchesInstagram } from '../../lib/who';

import type { Confirm, CopilotView, LinkState, SyncOutcome, SyncView } from './reveal-view';
import { accountPathOf, render, type Actions, type Screen } from './view';
import type { WatchNotice, WatchView } from './watch-view';

/**
 * The popup's browser side (ADR 0066): the CRM address from chrome.storage.local, the session read from the CRM,
 * the open tab through activeTab. It opens tabs and asks the browser for a site; it never writes to the API.
 */

const LIGHT = window.matchMedia('(prefers-color-scheme: light)');

/** Nuit or Jour as the browser or the computer is set (ADR 0066 § 8). */
function applyTheme(): void {
  if (LIGHT.matches) document.documentElement.dataset['theme'] = 'light';
  else delete document.documentElement.dataset['theme'];
}
applyTheme();
LIGHT.addEventListener('change', applyTheme);

const root = document.getElementById('app');
if (root === null) throw new Error('popup: #app is missing');

let origin = DEFAULT_CRM_ADDRESS;
/** No address was ever saved: the welcome stays until one is (EXT-07). */
let welcome = false;
let screen: Screen = { kind: 'loading' };
let previous: Screen = screen;

function show(next: Screen): void {
  if (next.kind !== 'address') previous = next;
  screen = next;
  if (root === null) return;
  render(
    root,
    screen,
    {
      origin,
      version: browser.runtime.getManifest().version,
      hour: new Date().getHours(),
      dev: import.meta.env.DEV,
    },
    actions,
  );
}

function currentScreen(): Screen {
  return screen;
}

async function allowed(at: string): Promise<boolean> {
  if (isGrantedAtInstall(at)) return true;
  return browser.permissions.contains({ origins: [permissionPatternOf(at)] }).catch(() => false);
}

async function activeTab(): Promise<{ id: number | undefined; url: string | undefined }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  return { id: tab?.id, url: tab?.url };
}

/* ---- The watch card (VEI-02): the popup asks the service worker, which alone holds the link and sends. ---- */

let tabId: number | undefined;
let creators: MarkableCreators['items'] = [];
let watchNotice: WatchNotice | null = null;
let watchDraft = '';
let busy = false;

function ask(message: FromPopup): Promise<unknown> {
  return browser.runtime.sendMessage(message).catch(() => null);
}

async function watchViewFor(): Promise<WatchView | null> {
  if (tabId === undefined) return null;
  const status = WatchStatusSchema.safeParse(await ask({ type: 'popup/status', tabId }));
  if (!status.success) return null;
  if (status.data.link === 'linked' && creators.length === 0) {
    const answer = MarkableCreatorsSchema.safeParse(await ask({ type: 'popup/creators' }));
    if (answer.success) creators = answer.data.items;
  }
  return { status: status.data, creators, notice: watchNotice, busy, now: new Date(), draft: watchDraft };
}

/** Draws the signed-in screen again with the watch as it stands now. */
async function redrawWatch(): Promise<void> {
  if (screen.kind !== 'signed_in' || screen.place !== 'instagram' || screen.watch === null) return;
  const watch = await watchViewFor();
  // The screen may have changed while the service worker answered.
  const now = currentScreen();
  if (now.kind === 'signed_in') show({ ...now, watch });
}

async function gesture(run: () => Promise<WatchNotice | null>): Promise<void> {
  busy = true;
  watchNotice = null;
  await redrawWatch();
  watchNotice = await run().catch(() => ({ tone: 'amber' as const, text: 'Ça n’a pas marché : réessaie.' }));
  busy = false;
  await redrawWatch();
}

const LINK_NOTICES: Readonly<Record<'refused' | 'unreachable' | 'malformed', string>> = {
  malformed: 'Ce n’est pas un code de liaison : copie-le en entier depuis le CRM.',
  refused: 'Le CRM ne reconnaît pas ce code : il a été délié ou remplacé. Crées-en un nouveau dans Sécurité.',
  unreachable: 'Le CRM ne répond pas : réessaie dans un instant.',
};

const MARK_NOTICES: Readonly<Record<'nothing-on-screen' | 'not-watching' | 'failed', string>> = {
  'nothing-on-screen': 'Aucun post en grand à l’écran : ouvre un Reel ou un post, puis marque-le.',
  'not-watching': 'La veille s’est arrêtée : relance-la.',
  failed: 'Le marquage n’est pas parti : vérifie la liaison, puis réessaie.',
};

async function beginWatch(): Promise<WatchNotice | null> {
  if (tabId === undefined) return null;
  const answer: unknown = await ask({ type: 'popup/begin', tabId });
  const started =
    typeof answer === 'object' && answer !== null && 'started' in answer && answer.started === true;
  return started ? null : { tone: 'amber', text: 'La veille ne démarre que sur un onglet instagram.com.' };
}

/* ---- The copilot's « Relier » (EXT-02): one link per extension, held by the service worker. ---- */

let copilotDraft = '';
let copilotNotice: WatchNotice | null = null;

async function linkStateNow(): Promise<LinkState> {
  const parsed = LinkStateSchema.safeParse(await ask({ type: 'popup/link-state' }));
  return parsed.success ? parsed.data.link : 'unknown';
}

async function copilotViewFor(): Promise<CopilotView> {
  return { link: await linkStateNow(), draft: copilotDraft, notice: copilotNotice, busy };
}

/* ---- The owner's « Sync » of the Reveal session (P2-01): the service worker reads, holds, sends, forgets it. ---- */

let syncOutcome: SyncOutcome | null = null;
let syncPending: SyncView['pending'] = null;
let syncConfirm: Confirm | null = null;
/** The service worker forgets a session read after a minute: the confirmation goes with it. */
let confirmTimer: ReturnType<typeof setTimeout> | undefined;
const CONFIRM_MS = 60_000;

async function syncViewFor(): Promise<SyncView> {
  const parsed = RevealAccountsSchema.safeParse(await ask({ type: 'popup/reveal-accounts' }));
  return {
    accounts: parsed.success ? parsed.data : { state: 'unreachable', accounts: [] },
    outcome: syncOutcome,
    pending: syncPending,
    confirm: syncConfirm,
    now: new Date(),
    crm: shortAddress(origin),
  };
}

/** Draws the Reveal cards again as the service worker sees them now. */
async function redrawReveal(): Promise<void> {
  if (screen.kind !== 'signed_in' || screen.copilot === null) return;
  const copilot = await copilotViewFor();
  const sync = screen.sync === null ? null : await syncViewFor();
  const now = currentScreen();
  if (now.kind === 'signed_in') show({ ...now, copilot, sync });
}

/** Draws the session card at once, with what is known, while the service worker works. */
function drawSync(): void {
  const now = currentScreen();
  if (now.kind === 'signed_in' && now.sync !== null)
    show({
      ...now,
      sync: {
        ...now.sync,
        outcome: syncOutcome,
        pending: syncPending,
        confirm: syncConfirm,
        now: new Date(),
      },
    });
}

function endConfirm(): void {
  clearTimeout(confirmTimer);
  syncConfirm = null;
}

/** Reads the session of the open tab for this account; the service worker holds it until the owner says. */
async function readSession(accountId: PlatformAccountId): Promise<void> {
  endConfirm();
  syncOutcome = null;
  syncPending = { accountId, phase: 'reading' };
  drawSync();
  const read =
    tabId === undefined
      ? null
      : (RevealReadSchema.safeParse(await ask({ type: 'popup/reveal-read', tabId, accountId })).data ?? null);
  syncPending = null;
  if (read === null) syncOutcome = { kind: 'failed', accountId, failure: 'unreachable' };
  else if (read.state !== 'held') syncOutcome = { kind: 'failed', accountId, failure: read.state };
  else {
    syncConfirm = { accountId, modelId: read.modelId, seen: read.seen };
    confirmTimer = setTimeout(() => {
      endConfirm();
      syncOutcome = { kind: 'failed', accountId, failure: 'expired' };
      drawSync();
    }, CONFIRM_MS);
  }
  drawSync();
}

async function sendSession(): Promise<void> {
  const confirm = syncConfirm;
  if (confirm === null) return;
  const { accountId } = confirm;
  endConfirm();
  syncPending = { accountId, phase: 'sending' };
  drawSync();
  const synced = RevealSyncedSchema.safeParse(await ask({ type: 'popup/reveal-send', accountId }));
  syncPending = null;
  syncOutcome = !synced.success
    ? { kind: 'failed', accountId, failure: 'unreachable' }
    : synced.data.state === 'synced'
      ? {
          kind: 'synced',
          accountId,
          expiresAt: synced.data.expiresAt,
          reconnectFirst: synced.data.reconnectFirst,
          kept: synced.data.kept,
        }
      : { kind: 'failed', accountId, failure: synced.data.state };
  await redrawReveal();
}

function cancelSession(): void {
  endConfirm();
  void ask({ type: 'popup/reveal-cancel' });
  drawSync();
}

async function refresh(): Promise<void> {
  if (welcome) {
    show({ kind: 'address', draft: '', error: null, first: true });
    return;
  }
  show({ kind: 'loading' });
  if (!(await allowed(origin))) {
    show({ kind: 'permission' });
    return;
  }
  const [session, tab] = await Promise.all([readCrmSession(origin), activeTab()]);
  tabId = tab.id;
  switch (session.kind) {
    case 'signed_in': {
      const place = placeOf(tab.url, origin);
      const kind = kindOf(session.me);
      // A member away from work has no copilot, no watch (EXT-10): the server refuses him anyway. The watch is the
      // owner's alone (ADR 0024, amendement du 16/11); a manager on Instagram is shown no card, and no error.
      const atWork = awayOf(session.me) === null;
      const watched = atWork && place === 'instagram' && watchesInstagram(kind);
      // The copilot is every member's but the creator's (EXT-09, ADR 0086 § 7); the « Sync » the owner's alone.
      const copilot = atWork && place === 'reveal' && kind !== 'creator';
      const syncs = copilot && kind === 'owner';
      show({
        kind: 'signed_in',
        me: session.me,
        place,
        copilot: copilot ? await copilotViewFor() : null,
        watch: watched ? await watchViewFor() : null,
        sync: syncs ? await syncViewFor() : null,
      });
      return;
    }
    case 'signed_out':
      show({ kind: 'signed_out' });
      return;
    case 'second_factor_required':
      show({ kind: 'second_factor' });
      return;
    case 'server_down':
    case 'not_crm':
    case 'refused':
      show({ kind: session.kind });
      return;
    case 'unreachable':
      show({ kind: 'unreachable' });
      return;
  }
}

/**
 * Opens a page of the CRM: in the open tab when it already shows the CRM, else in the CRM tab of this window if
 * there is one, else in a new tab. The popup closes behind it.
 */
async function openCrm(path: string): Promise<void> {
  const url = `${origin}${path}`;
  const [active] = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const [crmTab] = await browser.tabs
    .query({ url: permissionPatternOf(origin), currentWindow: true })
    .catch(() => []);
  const target = active?.url?.startsWith(`${origin}/`) === true ? active : crmTab;
  if (target?.id === undefined) await browser.tabs.create({ url });
  else await browser.tabs.update(target.id, { url, active: true });
  window.close();
}

/** Saves an address the person typed; a deployed CRM asks the browser for that site alone, in the same click. */
function saveAddress(value: string): void {
  const next = crmOriginOf(value);
  if (next === null) {
    show({
      kind: 'address',
      draft: value,
      error: 'Une adresse en https, comme crm.exemple.fr.',
      first: welcome,
    });
    return;
  }
  origin = next;
  welcome = false;
  // Stored first, without waiting: the permission request must stay inside the click (user gesture).
  void browser.storage.local.set({ [ADDRESS_KEY]: next });
  if (isGrantedAtInstall(next)) {
    void refresh();
    return;
  }
  void browser.permissions
    .request({ origins: [permissionPatternOf(next)] })
    .catch(() => false)
    .then(() => refresh());
  show({ kind: 'loading' });
}

/** This window, read at once: `sidePanel.open` must run in the click itself, before any await (ADR 0086 § 1). */
let windowId: number | undefined;
void browser.windows
  .getCurrent()
  .then((current) => {
    windowId = current.id;
  })
  .catch(() => undefined);

/**
 * The copilot beside Reveal: the browser's side panel, or the same page in a small window next to it where the browser
 * has none (ADR 0086 § 1). The window is told which window's tab to follow.
 */
function openPanel(): void {
  if (windowId === undefined) return;
  const atWindow = windowId;
  const fallback = (): void => {
    const url = browser.runtime.getURL(`/sidepanel.html?window=${String(atWindow)}`);
    void browser.windows.create({ url, type: 'popup', width: 380, height: 760 }).catch(() => undefined);
  };
  if ('sidePanel' in browser && typeof browser.sidePanel.open === 'function') {
    browser.sidePanel.open({ windowId: atWindow }).then(() => {
      window.close();
    }, fallback);
  } else {
    fallback();
    window.close();
  }
}

const actions: Actions = {
  openPanel,
  signIn: () => void openCrm('/'),
  open: (path) => void openCrm(path),
  retry: () => void refresh(),
  grant: () => {
    void browser.permissions
      .request({ origins: [permissionPatternOf(origin)] })
      .catch(() => false)
      .then(() => refresh());
  },
  editAddress: () => {
    show({ kind: 'address', draft: origin.replace(/^https?:\/\//u, ''), error: null, first: false });
  },
  saveAddress,
  resetAddress: () => {
    saveAddress(DEFAULT_CRM_ADDRESS);
  },
  cancelAddress: () => {
    show(previous);
  },
  watch: {
    link: (code) => {
      watchDraft = code;
      void gesture(async () => {
        const saved = LinkSavedSchema.safeParse(await ask({ type: 'popup/link', token: code }));
        if (!saved.success) return { tone: 'amber', text: LINK_NOTICES.unreachable };
        if (saved.data.state !== 'linked') return { tone: 'amber', text: LINK_NOTICES[saved.data.state] };
        watchDraft = '';
        creators = [];
        return { tone: 'quiet', text: 'Extension reliée : tu peux lancer la veille.' };
      });
    },
    allow: () => {
      // Asked inside the click (a user gesture), for instagram.com alone.
      const asked = browser.permissions.request({ origins: [INSTAGRAM_PATTERN] }).catch(() => false);
      void gesture(async () =>
        (await asked)
          ? beginWatch()
          : { tone: 'amber', text: 'Sans cette autorisation, la veille ne peut rien lire.' },
      );
    },
    begin: () => {
      void gesture(beginWatch);
    },
    end: () => {
      void gesture(async () => {
        if (tabId !== undefined) await ask({ type: 'popup/end', tabId });
        return null;
      });
    },
    mark: (creatorId) => {
      void gesture(async () => {
        if (tabId === undefined) return null;
        const marked = MarkedSchema.safeParse(await ask({ type: 'popup/mark', tabId, creatorId }));
        if (!marked.success) return { tone: 'amber', text: MARK_NOTICES.failed };
        if (marked.data.state !== 'marked') return { tone: 'amber', text: MARK_NOTICES[marked.data.state] };
        const name = creators.find((creator) => creator.id === creatorId)?.displayName ?? 'elle';
        return { tone: 'quiet', text: `Marqué pour ${name}. Les captures partent en arrière-plan.` };
      });
    },
    openSecurity: () => {
      if (screen.kind === 'signed_in') void openCrm(accountPathOf(screen.me));
    },
  },
  copilot: {
    link: (code) => {
      copilotDraft = code;
      void (async () => {
        busy = true;
        copilotNotice = null;
        await redrawReveal();
        const saved = LinkSavedSchema.safeParse(await ask({ type: 'popup/link', token: code }));
        copilotNotice = !saved.success
          ? { tone: 'amber', text: LINK_NOTICES.unreachable }
          : saved.data.state !== 'linked'
            ? { tone: 'amber', text: LINK_NOTICES[saved.data.state] }
            : { tone: 'quiet', text: 'Extension reliée : tes gestes du copilote comptent à ton nom.' };
        if (saved.data?.state === 'linked') copilotDraft = '';
        busy = false;
        await redrawReveal();
      })();
    },
    openSecurity: () => {
      if (screen.kind === 'signed_in') void openCrm(accountPathOf(screen.me));
    },
  },
  sync: {
    sync: (accountId) => void readSession(accountId),
    send: () => void sendSession(),
    cancel: cancelSession,
    retry: () => void redrawReveal(),
  },
};

// While the popup stays open on a watch, its minutes and counts follow.
setInterval(() => {
  if (!busy) void redrawWatch();
}, 15_000);

// The popup's port to the service worker: closing the popup closes it, and a session read and not sent is forgotten.
browser.runtime.connect({ name: 'popup' });

void savedOrigin().then((saved) => {
  welcome = saved === null;
  origin = saved ?? DEFAULT_CRM_ADDRESS;
  return refresh();
});
