import {
  CONNECTOR_LINK_FORBIDDEN,
  CreatorIdSchema,
  WatchSessionIdSchema,
  type ConnectorAccounts,
  type CreatorId,
  type PlatformAccountId,
  type TrendReadingsBatch,
} from '@impera/contracts';
import { browser, type Browser } from 'wxt/browser';
import { z } from 'zod';

import { FromPanelSchema, sendVerdict, type VerdictSent } from '../lib/copilot/verdict';
import { storedOrigin } from '../lib/crm-origin-store';
import { fetchSyncableAccounts, sendSession } from '../lib/reveal/api';
import { REVEAL_API_PATTERN } from '../lib/reveal/capture';
import {
  captureSession,
  readReveal,
  sendHeld,
  sessionHold,
  type RequestTap,
  type SeenRequest,
} from '../lib/reveal/sync';
import { placeOf } from '../lib/tab';
import {
  fetchLinkHolder,
  fetchMarkableCreators,
  linkCode,
  sendCaptures,
  sendReadings,
} from '../lib/watch/api';
import { captureMarked } from '../lib/watch/captures';
import { forgetLink, linkState, markRevoked, readLink, saveLink } from '../lib/watch/link-store';
import { postOfHref } from '../lib/watch/pages';
import {
  FromPopupSchema,
  FromReaderSchema,
  OnScreenAnswerSchema,
  type FromPopup,
  type FromReader,
  type LinkSaved,
  type MarkableCreators,
  type Marked,
  type OnScreen,
  type RevealAccounts,
  type RevealRead,
  type SeenPost,
  type ToReader,
  type WatchStatus,
} from '../lib/watch/protocol';
import {
  addSeen,
  begin,
  end,
  expired,
  mark,
  parseState,
  prune,
  putBack,
  takeBatches,
  watchOf,
  type WatchState,
} from '../lib/watch/state';
import { injectInto, instagramAllowed, syncWatchScript } from '../lib/watch/watch-script';

/**
 * The service worker (ADR 0066, VEI-02). It is thrown away between events, so the watches live in
 * `chrome.storage.session` and every timer is an alarm. It alone sends to the API, with the person's link; the reader
 * on instagram.com only reads and tells it.
 */

const STATE_KEY = 'watch';
/** The model of each Reveal account's last sync, to check the next one against: an id, never a session. */
const MODELS_KEY = 'revealModels';
const ModelsSchema = z.record(z.string(), z.string());
/** The popup's port: when it closes, a session it held is forgotten. */
const POPUP_PORT = 'popup';
const FLUSH_ALARM = 'watch-flush';
const MENU_PARENT = 'watch-mark';
const MENU_PREFIX = 'watch-mark:';
const POST_LINKS = [
  'https://www.instagram.com/p/*',
  'https://www.instagram.com/reel/*',
  'https://www.instagram.com/reels/*',
  'https://www.instagram.com/*/p/*',
  'https://www.instagram.com/*/reel/*',
];
/** The badge: a quiet mauve while it reads (red is for urgencies), amber when the page stopped giving anything. */
const BADGE = { watching: '#3b3048', amber: '#ffa340', amberInk: '#1d1612' } as const;

export default defineBackground(() => {
  /* ---- State, one change at a time ---- */

  let queue: Promise<unknown> = Promise.resolve();
  function withState<T>(
    change: (state: WatchState) => Promise<[WatchState, T]> | [WatchState, T],
  ): Promise<T> {
    const run = queue.then(async () => {
      const stored: Record<string, unknown> = await browser.storage.session.get(STATE_KEY).catch(() => ({}));
      const [next, result] = await change(parseState(stored[STATE_KEY]));
      await browser.storage.session.set({ [STATE_KEY]: next });
      return result;
    });
    queue = run.catch(() => undefined);
    return run;
  }
  const readState = (): Promise<WatchState> => withState((state) => [state, state]);

  // The popup's address, or the built-in one of a hosted build (ADR 0067, second amendement), or this computer's.
  const crmOrigin = storedOrigin;

  /* ---- The reader in a tab ---- */

  async function tellReader(tabId: number, message: ToReader): Promise<unknown> {
    return browser.tabs.sendMessage(tabId, message, { frameId: 0 });
  }

  async function onScreenIn(tabId: number): Promise<OnScreen | null> {
    const answer: unknown = await tellReader(tabId, { type: 'watch/on-screen' }).catch(() => null);
    return OnScreenAnswerSchema.safeParse(answer).data?.onScreen ?? null;
  }

  /* ---- Badge and menu ---- */

  async function paintBadge(tabId: number, watching: boolean, amber: boolean): Promise<void> {
    const action = browser.action;
    if (!watching) {
      await action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
      await action.setTitle({ tabId, title: 'Impera' }).catch(() => undefined);
      return;
    }
    await action.setBadgeText({ tabId, text: amber ? '!' : '•' }).catch(() => undefined);
    await action
      .setBadgeBackgroundColor({ tabId, color: amber ? BADGE.amber : BADGE.watching })
      .catch(() => undefined);
    if (amber) await action.setBadgeTextColor({ tabId, color: BADGE.amberInk }).catch(() => undefined);
    await action
      .setTitle({
        tabId,
        title: amber ? 'Impera · Veille : la page ne donne plus rien' : 'Impera · Veille en cours',
      })
      .catch(() => undefined);
  }

  async function syncMenu(state: WatchState): Promise<void> {
    const visible = Object.keys(state.watches).length > 0;
    await browser.contextMenus.update(MENU_PARENT, { visible }).catch(() => undefined);
  }

  async function rebuildMenu(creators: MarkableCreators['items']): Promise<void> {
    await browser.contextMenus.removeAll().catch(() => undefined);
    const state = await readState();
    browser.contextMenus.create({
      id: MENU_PARENT,
      title: 'Marquer ce post pour…',
      contexts: ['link'],
      targetUrlPatterns: POST_LINKS,
      documentUrlPatterns: ['https://www.instagram.com/*'],
      visible: Object.keys(state.watches).length > 0,
    });
    for (const creator of creators.slice(0, 20)) {
      browser.contextMenus.create({
        id: `${MENU_PREFIX}${creator.id}`,
        parentId: MENU_PARENT,
        title: creator.displayName,
        contexts: ['link'],
      });
    }
  }

  /* ---- Sending ---- */

  async function flush(): Promise<'sent' | 'kept' | 'revoked'> {
    const token = await readLink();
    const origin = await crmOrigin();
    const batches = await withState((state) => {
      const { batches: taken, rest } = takeBatches(state);
      return [token === null ? state : rest, token === null ? [] : taken];
    });
    if (token === null) return 'kept';
    const unsent: TrendReadingsBatch[] = [];
    let outcome: 'sent' | 'kept' | 'revoked' = 'sent';
    for (const batch of batches) {
      const sent = await sendReadings(origin, token, batch);
      // A CRM counting too many tries (429) keeps the batch too: it is sent again with the next flush.
      if (sent.kind === 'unreachable' || sent.kind === 'busy') {
        unsent.push(batch);
        outcome = 'kept';
      } else if (sent.kind === 'revoked') {
        unsent.push(batch);
        outcome = 'revoked';
      }
      // A batch refused for its shape (400, 422) is dropped: sending it again would be refused again.
    }
    if (outcome === 'revoked') await markRevoked();
    await withState((state) => [prune(putBack(state, unsent), new Date()), null]);
    return outcome;
  }

  /* ---- Watch life ---- */

  async function startWatch(tabId: number): Promise<boolean> {
    if (!(await instagramAllowed())) return false;
    const tab = await browser.tabs.get(tabId).catch(() => null);
    if (placeOf(tab?.url, '') !== 'instagram') return false;
    await syncWatchScript();
    const session = WatchSessionIdSchema.parse(crypto.randomUUID());
    const state = await withState((current) => {
      const next = begin(current, tabId, session, new Date());
      return [next, next];
    });
    const watch = watchOf(state, tabId);
    if (watch !== null)
      void browser.alarms.create(`watch-end:${String(tabId)}`, { when: Date.parse(watch.endsAt) });
    void browser.alarms.create(FLUSH_ALARM, { periodInMinutes: 0.5 });
    await paintBadge(tabId, true, false);
    await syncMenu(state);
    // A tab opened before Instagram was allowed has no reader yet: it is put in once, and says hello.
    const started = await tellReader(tabId, { type: 'watch/start' }).then(
      () => true,
      () => false,
    );
    if (!started) await injectInto(tabId);
    return true;
  }

  async function stopWatch(tabId: number, reader: 'tell' | 'gone'): Promise<void> {
    if (reader === 'tell') await tellReader(tabId, { type: 'watch/stop' }).catch(() => undefined);
    const state = await withState((current) => {
      const next = end(current, tabId, new Date());
      return [next, next];
    });
    await browser.alarms.clear(`watch-end:${String(tabId)}`).catch(() => undefined);
    if (Object.keys(state.watches).length === 0)
      await browser.alarms.clear(FLUSH_ALARM).catch(() => undefined);
    await paintBadge(tabId, false, false);
    await syncMenu(state);
    // The reader's last posts arrive as it stops: they are sent a moment later.
    void browser.alarms.create(`${FLUSH_ALARM}-once`, { when: Date.now() + 3_000 });
  }

  async function markPost(
    tabId: number,
    creatorId: CreatorId,
    post: SeenPost | null,
  ): Promise<Marked['state']> {
    const state = await readState();
    const watch = watchOf(state, tabId);
    if (watch === null) return 'not-watching';
    const onScreen = await onScreenIn(tabId);
    const marked = post ?? onScreen?.post ?? null;
    if (marked === null) return 'nothing-on-screen';
    await withState((current) => [mark(current, tabId, marked, creatorId), null]);
    // The reading goes first, marked: the captures are taken only for a post the server holds as marked.
    const sent = await flush();
    if (sent !== 'sent' || onScreen?.post.code !== marked.code)
      return sent === 'revoked' ? 'failed' : 'marked';
    void describe(tabId, watch.session, onScreen);
    return 'marked';
  }

  async function describe(tabId: number, session: string, onScreen: OnScreen): Promise<void> {
    const tab = await browser.tabs.get(tabId).catch(() => null);
    if (tab?.windowId === undefined) return;
    const windowId = tab.windowId;
    const captures = await captureMarked(onScreen.post.code, {
      shoot: async (quality) => {
        const current = await browser.tabs.get(tabId).catch(() => null);
        // Only the watched tab, while it is the one shown in its window.
        if (current?.active !== true) return null;
        return browser.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality }).catch(() => null);
      },
      onScreen: async () => (await onScreenIn(tabId))?.post.code ?? null,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    if (captures.length === 0) return;
    const token = await readLink();
    if (token === null) return;
    const described = await sendCaptures(await crmOrigin(), token, {
      watchSession: WatchSessionIdSchema.parse(session),
      code: onScreen.post.code,
      durationS: onScreen.durationS,
      captures: [...captures],
    });
    if (described === 'revoked') {
      await markRevoked();
      return;
    }
    await withState((state) => [{ ...state, vision: described }, null]);
  }

  /* ---- The reader's messages ---- */

  async function fromReader(message: FromReader, tabId: number): Promise<unknown> {
    switch (message.type) {
      case 'watch/hello': {
        const state = await readState();
        return { watching: watchOf(state, tabId) !== null };
      }
      case 'watch/seen': {
        const waiting = await withState((state) => {
          const next = addSeen(state, tabId, message.posts);
          const count = Object.values(next.pending).reduce(
            (sum, posts) => sum + Object.keys(posts).length,
            0,
          );
          return [next, count];
        });
        if (waiting >= 50) void flush();
        return { ok: true };
      }
      case 'watch/health': {
        const state = await withState((current) => {
          const watch = watchOf(current, tabId);
          if (watch === null) return [current, current];
          const next = {
            ...current,
            watches: { ...current.watches, [String(tabId)]: { ...watch, amber: message.amber } },
          };
          return [next, next];
        });
        if (watchOf(state, tabId) !== null) await paintBadge(tabId, true, message.amber);
        return { ok: true };
      }
    }
  }

  /* ---- The popup's messages ---- */

  async function creatorsFor(token: string | null): Promise<MarkableCreators> {
    if (token === null) return { state: 'none', items: [] };
    const answer = await fetchMarkableCreators(await crmOrigin(), token);
    if (answer.kind === 'ok') {
      await rebuildMenu(answer.value.items);
      return { state: 'ok', items: answer.value.items };
    }
    if (answer.kind === 'revoked') {
      await markRevoked();
      return { state: 'revoked', items: [] };
    }
    return { state: 'unreachable', items: [] };
  }

  /* ---- The owner's « Sync » of a Reveal session (P2-01) ---- */

  /**
   * The model the CRM keeps for this account (`modelId`, the session's owner), asked at each reading: the tab is then
   * read for that creator. Null before the first « Sync », or when the CRM does not answer.
   */
  async function crmModel(accountId: PlatformAccountId): Promise<string | null> {
    return (await crmAccounts()).find((account) => account.id === accountId)?.modelId ?? null;
  }

  /** The CRM's Reveal accounts with their models; none when it does not answer. */
  async function crmAccounts(): Promise<ConnectorAccounts['accounts']> {
    const token = await readLink();
    if (token === null) return [];
    const answer = await fetchSyncableAccounts(await crmOrigin(), token).catch(() => null);
    return answer?.kind === 'ok' ? answer.value.accounts : [];
  }

  async function revealAccounts(): Promise<RevealAccounts> {
    const token = await readLink();
    if (token === null) return { state: 'none', accounts: [] };
    const answer = await fetchSyncableAccounts(await crmOrigin(), token);
    switch (answer.kind) {
      case 'ok':
        return {
          state: 'ok',
          accounts: answer.value.accounts.map(
            ({ id, handle, creatorName, sessionState, sessionUpdatedAt }) => ({
              id,
              handle,
              creatorName,
              sessionState,
              sessionUpdatedAt,
              // The CRM does not list the end of a session yet: the card says it after a « Sync » only.
              sessionExpiresAt: null,
            }),
          ),
        };
      case 'revoked':
        await markRevoked();
        return { state: 'revoked', accounts: [] };
      case 'refused':
        return {
          state: answer.code === CONNECTOR_LINK_FORBIDDEN ? 'not-owner' : 'unreachable',
          accounts: [],
        };
      case 'busy':
        return { state: 'busy', accounts: [] };
      case 'unreachable':
        return { state: 'unreachable', accounts: [] };
    }
  }

  /** The Reveal tab's requests, heard only while a « Sync » waits; the listener is removed as soon as it ends. */
  type Heard = Parameters<typeof browser.webRequest.onBeforeSendHeaders.addListener>[0];
  const heard = new Map<(request: SeenRequest) => void, Heard>();
  const revealTap: RequestTap = {
    listen: (tabId, listener) => {
      const registered: Heard = (details) => {
        listener({ url: details.url, requestHeaders: details.requestHeaders ?? [] });
        return undefined;
      };
      heard.set(listener, registered);
      browser.webRequest.onBeforeSendHeaders.addListener(registered, { urls: [REVEAL_API_PATTERN], tabId }, [
        'requestHeaders',
        'extraHeaders',
      ]);
    },
    stop: (listener) => {
      const registered = heard.get(listener);
      heard.delete(listener);
      if (registered !== undefined) browser.webRequest.onBeforeSendHeaders.removeListener(registered);
    },
    reload: (tabId) => {
      void browser.tabs.reload(tabId).catch(() => undefined);
    },
  };

  /** The session read and not sent yet: this worker's memory alone (lib/reveal/sync.ts). */
  const held = sessionHold();

  async function revealModels(): Promise<Readonly<Record<string, string>>> {
    const stored: Record<string, unknown> = await browser.storage.local.get(MODELS_KEY).catch(() => ({}));
    return ModelsSchema.safeParse(stored[MODELS_KEY]).data ?? {};
  }

  // The popup closes: what it held is forgotten, sent or not.
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== POPUP_PORT || port.sender?.id !== browser.runtime.id) return;
    port.onDisconnect.addListener(() => {
      held.drop();
    });
  });

  async function fromPopup(message: FromPopup): Promise<unknown> {
    switch (message.type) {
      case 'popup/status': {
        const state = await readState();
        const watch = watchOf(state, message.tabId);
        const status: WatchStatus = {
          allowed: await instagramAllowed(),
          link: await linkState(),
          watch:
            watch === null
              ? null
              : {
                  startedAt: watch.startedAt,
                  endsAt: watch.endsAt,
                  posts: watch.posts,
                  marked: watch.marked,
                  amber: watch.amber,
                },
          vision: state.vision,
          lastCreatorId: state.lastCreatorId,
        };
        return status;
      }
      case 'popup/begin':
        return { started: await startWatch(message.tabId) };
      case 'popup/end':
        await stopWatch(message.tabId, 'tell');
        return { ok: true };
      case 'popup/mark':
        return { state: await markPost(message.tabId, message.creatorId, null) } satisfies Marked;
      case 'popup/creators':
        return creatorsFor(await readLink());
      case 'popup/link': {
        const trimmed = message.token.trim();
        if (!/^[A-Za-z0-9_-]{43}$/u.test(trimmed)) return { state: 'malformed' } satisfies LinkSaved;
        const origin = await crmOrigin();
        const state = await linkCode(trimmed, {
          check: (token) => fetchLinkHolder(origin, token),
          save: saveLink,
          // The watch's menu, for a holder of the watch only; an answer missing now is asked again with the popup.
          watch: async (token) => {
            const creators = await fetchMarkableCreators(origin, token);
            if (creators.kind === 'ok') await rebuildMenu(creators.value.items);
          },
        });
        return { state } satisfies LinkSaved;
      }
      case 'popup/unlink':
        await forgetLink();
        // The models of past syncs go with the link that made them (avis de Sécurité sur #841).
        await browser.storage.local.remove(MODELS_KEY);
        return { ok: true };
      case 'popup/reveal-accounts':
        return revealAccounts();
      case 'popup/link-state':
        return { link: await linkState() };
      case 'popup/reveal-read': {
        const tab = await browser.tabs.get(message.tabId).catch(() => null);
        // Only from a Reveal tab: its requests are the ones read.
        if (placeOf(tab?.url, '') !== 'reveal') return { state: 'no-session' } satisfies RevealRead;
        return readReveal(
          {
            readLink,
            capture: (expected) =>
              captureSession(revealTap, message.tabId, expected, {
                userAgent: navigator.userAgent,
                now: () => new Date(),
              }),
            expectedModel: async (accountId) =>
              (await crmModel(accountId)) ?? (await revealModels())[accountId] ?? null,
            accountOfModel: async (modelId, except) => {
              const remembered = await revealModels();
              const accounts = await crmAccounts();
              const other = accounts.find(
                (account) =>
                  account.id !== except && (account.modelId ?? remembered[account.id] ?? null) === modelId,
              );
              return other?.id ?? null;
            },
          },
          held,
          message.accountId,
        );
      }
      case 'popup/reveal-send':
        return sendHeld(
          {
            readLink,
            markRevoked,
            origin: crmOrigin,
            send: sendSession,
            remember: async (accountId, modelId) => {
              await browser.storage.local.set({
                [MODELS_KEY]: { ...(await revealModels()), [accountId]: modelId },
              });
            },
          },
          held,
          message.accountId,
        );
      case 'popup/reveal-cancel':
        held.drop();
        return { ok: true };
    }
  }

  browser.runtime.onMessage.addListener(
    (raw: unknown, sender: Browser.runtime.MessageSender, respond: (answer: unknown) => void) => {
      if (sender.id !== browser.runtime.id) return false;
      // The copilot panel's gesture on a draft (ADR 0086 § 8): sent here with the link the panel never reads. Told by
      // the page that sends it, never by a tab: in the small window of the fallback, the panel is a tab too.
      const gesture = FromPanelSchema.safeParse(raw);
      if (gesture.success && sender.url?.startsWith(browser.runtime.getURL('/sidepanel.html')) === true) {
        void (async (): Promise<VerdictSent> => {
          const token = await readLink();
          const sent = await sendVerdict(await crmOrigin(), token, gesture.data.draftId, gesture.data.body);
          if (sent === 'unlinked' && token !== null) await markRevoked();
          return sent;
        })().then(respond, () => {
          respond('unreachable' satisfies VerdictSent);
        });
        return true;
      }
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        // A reader, from the top frame of an Instagram tab.
        if (sender.frameId !== 0 || placeOf(sender.tab?.url, '') !== 'instagram') return false;
        const message = FromReaderSchema.safeParse(raw);
        if (!message.success) return false;
        void fromReader(message.data, tabId).then(respond, () => {
          respond(null);
        });
        return true;
      }
      const message = FromPopupSchema.safeParse(raw);
      if (!message.success) return false;
      void fromPopup(message.data).then(respond, () => {
        respond(null);
      });
      return true;
    },
  );

  /* ---- Timers, tabs, menu, shortcut ---- */

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === FLUSH_ALARM || alarm.name === `${FLUSH_ALARM}-once`) {
      void (async () => {
        const state = await readState();
        for (const tabId of expired(state, new Date())) await stopWatch(tabId, 'tell');
        await flush();
      })();
      return;
    }
    const ending = /^watch-end:(\d+)$/u.exec(alarm.name)?.[1];
    if (ending !== undefined) void stopWatch(Number(ending), 'tell');
  });

  // Leaving Instagram ends the watch: a page the extension may not read (tab.url hidden) is not Instagram.
  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status !== 'loading' && change.url === undefined) return;
    void readState().then((state) => {
      if (watchOf(state, tabId) !== null && placeOf(tab.url, '') !== 'instagram')
        return stopWatch(tabId, 'gone');
      return undefined;
    });
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void readState().then((state) => (watchOf(state, tabId) === null ? undefined : stopWatch(tabId, 'gone')));
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    const creator = CreatorIdSchema.safeParse(String(info.menuItemId).slice(MENU_PREFIX.length));
    const post = postOfHref(info.linkUrl ?? null);
    if (tab?.id === undefined || !creator.success || post === null) return;
    const tabId = tab.id;
    void (async () => {
      const onScreen = await onScreenIn(tabId);
      // The post on screen is marked with its captures; a link of a grid is marked as read, without them.
      const seen: SeenPost =
        onScreen?.post.code === post.code
          ? onScreen.post
          : {
              code: post.code,
              path: post.path,
              account: null,
              metrics: { views: null, likes: null, comments: null },
              caption: null,
              hashtags: [],
              sound: null,
              soundId: null,
              dwellMs: 0,
              seenAt: new Date().toISOString(),
            };
      await markPost(tabId, creator.data, onScreen?.post.code === post.code ? null : seen);
    })();
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'mark-post' || tab?.id === undefined) return;
    const tabId = tab.id;
    void (async () => {
      const state = await readState();
      if (state.lastCreatorId !== null) {
        await markPost(tabId, state.lastCreatorId, null);
        return;
      }
      // No creator chosen yet in this watch: the popup asks which one.
      await browser.action.openPopup().catch(() => undefined);
    })();
  });

  browser.runtime.onInstalled.addListener(() => {
    void syncWatchScript();
    void rebuildMenu([]);
  });
  browser.runtime.onStartup.addListener(() => {
    void syncWatchScript();
  });
  browser.permissions.onAdded.addListener(() => {
    void syncWatchScript();
  });
  browser.permissions.onRemoved.addListener(() => {
    void syncWatchScript();
  });
});
