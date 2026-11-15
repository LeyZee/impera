import '@impera/design-system/styles.css';
import './popup.css';

import { browser } from 'wxt/browser';

import {
  crmOriginOf,
  DEFAULT_CRM_ADDRESS,
  isGrantedAtInstall,
  permissionPatternOf,
} from '../../lib/crm-address';
import { ADDRESS_KEY, storedOrigin } from '../../lib/crm-origin-store';
import { readCrmSession } from '../../lib/session';
import { placeOf } from '../../lib/tab';
import {
  LinkSavedSchema,
  MarkableCreatorsSchema,
  MarkedSchema,
  RevealAccountsSchema,
  RevealSyncedSchema,
  WatchStatusSchema,
  type FromPopup,
  type MarkableCreators,
  type RevealSynced,
} from '../../lib/watch/protocol';
import { INSTAGRAM_PATTERN } from '../../lib/watch/watch-script';
import { kindOf, watchesInstagram } from '../../lib/who';

import type { SyncView } from './reveal-view';
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
let screen: Screen = { kind: 'loading' };
let previous: Screen = screen;

function show(next: Screen): void {
  if (next.kind !== 'address') previous = next;
  screen = next;
  if (root === null) return;
  render(
    root,
    screen,
    { origin, version: browser.runtime.getManifest().version, hour: new Date().getHours() },
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

/* ---- The owner's « Sync » of the Reveal session (P2-01): the service worker reads, sends and forgets it. ---- */

let syncNotice: WatchNotice | null = null;
let syncDraft = '';

async function syncViewFor(): Promise<SyncView> {
  const parsed = RevealAccountsSchema.safeParse(await ask({ type: 'popup/reveal-accounts' }));
  return {
    accounts: parsed.success ? parsed.data : { state: 'unreachable', accounts: [] },
    notice: syncNotice,
    busy,
    draft: syncDraft,
    now: new Date(),
  };
}

async function redrawSync(): Promise<void> {
  if (screen.kind !== 'signed_in' || screen.sync === null) return;
  const sync = await syncViewFor();
  const now = currentScreen();
  if (now.kind === 'signed_in') show({ ...now, sync });
}

async function syncGesture(run: () => Promise<WatchNotice | null>): Promise<void> {
  busy = true;
  syncNotice = null;
  const now = currentScreen();
  if (now.kind === 'signed_in' && now.sync !== null)
    show({ ...now, sync: { ...now.sync, busy: true, notice: null } });
  syncNotice = await run().catch(() => ({ tone: 'amber' as const, text: 'Ça n’a pas marché : réessaie.' }));
  busy = false;
  await redrawSync();
}

const SYNC_NOTICES: Readonly<Record<Exclude<RevealSynced['state'], 'synced'>, string>> = {
  'no-session': 'Aucune session lue : ouvre la messagerie de Reveal dans cet onglet, puis réessaie.',
  unlinked: 'Relie d’abord l’extension avec le code de Sécurité.',
  revoked: 'Cette liaison a été retirée dans le CRM : colle un nouveau code.',
  'not-owner': 'Seul le propriétaire synchronise une session.',
  'other-model': 'Cet onglet montre une autre créatrice que ce compte : ouvre la bonne dans Reveal.',
  'other-member':
    'Cet onglet est connecté avec un autre membre Reveal que le membre « bot » de ce compte : connecte-toi avec le membre « bot ».',
  refused: 'Le CRM a refusé cette session : vérifie que l’onglet est bien connecté à Reveal.',
  unreachable: 'Le CRM ne répond pas : réessaie dans un instant.',
};

async function refresh(): Promise<void> {
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
      // The watch is the owner's and the active managers' (ADR 0060 § 2): never a chatter's, nor a creator's here.
      const watched = place === 'instagram' && watchesInstagram(kind);
      // The « Sync » is the owner's alone (reveal-connector-spec.md § 2).
      const syncs = place === 'reveal' && kind === 'owner';
      show({
        kind: 'signed_in',
        me: session.me,
        place,
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
      show({ kind: 'server_down' });
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
      error: 'Une adresse en https, ou localhost sur ce PC (exemple : crm.exemple.fr).',
    });
    return;
  }
  origin = next;
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
    show({ kind: 'address', draft: origin.replace(/^https?:\/\//u, ''), error: null });
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
  sync: {
    link: (code) => {
      syncDraft = code;
      void syncGesture(async () => {
        const saved = LinkSavedSchema.safeParse(await ask({ type: 'popup/link', token: code }));
        if (!saved.success) return { tone: 'amber', text: LINK_NOTICES.unreachable };
        if (saved.data.state !== 'linked') return { tone: 'amber', text: LINK_NOTICES[saved.data.state] };
        syncDraft = '';
        return { tone: 'quiet', text: 'Extension reliée : tu peux synchroniser.' };
      });
    },
    sync: (accountId) => {
      void syncGesture(async () => {
        if (tabId === undefined) return { tone: 'amber', text: SYNC_NOTICES['no-session'] };
        const synced = RevealSyncedSchema.safeParse(
          await ask({ type: 'popup/reveal-sync', tabId, accountId }),
        );
        if (!synced.success) return { tone: 'amber', text: SYNC_NOTICES.unreachable };
        if (synced.data.state === 'synced') return { tone: 'quiet', text: 'Session envoyée au CRM.' };
        return { tone: 'amber', text: SYNC_NOTICES[synced.data.state] };
      });
    },
    retry: () => void redrawSync(),
    openSecurity: () => {
      if (screen.kind === 'signed_in') void openCrm(accountPathOf(screen.me));
    },
  },
};

// While the popup stays open on a watch, its minutes and counts follow.
setInterval(() => {
  if (!busy) void redrawWatch();
}, 15_000);

void storedOrigin().then((stored) => {
  origin = stored;
  return refresh();
});
