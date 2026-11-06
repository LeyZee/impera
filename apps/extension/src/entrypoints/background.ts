import {
  CreatorIdSchema,
  WatchSessionIdSchema,
  type CreatorId,
  type TrendReadingsBatch,
} from '@impera/contracts';
import { browser, type Browser } from 'wxt/browser';

import { crmOriginOf, DEFAULT_CRM_ADDRESS } from '../lib/crm-address';
import { placeOf } from '../lib/tab';
import { fetchMarkableCreators, sendCaptures, sendReadings } from '../lib/watch/api';
import { captureMarked } from '../lib/watch/captures';
import {
  forgetLink,
  linkState,
  markRevoked,
  readLink,
  restrictToTrustedContexts,
  saveLink,
} from '../lib/watch/link-store';
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
const ADDRESS_KEY = 'crmOrigin';
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

  async function crmOrigin(): Promise<string> {
    const stored: Record<string, unknown> = await browser.storage.local.get(ADDRESS_KEY).catch(() => ({}));
    const value = stored[ADDRESS_KEY];
    return typeof value === 'string' ? (crmOriginOf(value) ?? DEFAULT_CRM_ADDRESS) : DEFAULT_CRM_ADDRESS;
  }

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
      if (sent.kind === 'unreachable') {
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
        const answer = await fetchMarkableCreators(await crmOrigin(), trimmed);
        if (answer.kind === 'revoked' || answer.kind === 'refused')
          return { state: 'refused' } satisfies LinkSaved;
        if (answer.kind === 'unreachable') return { state: 'unreachable' } satisfies LinkSaved;
        await saveLink(trimmed);
        await rebuildMenu(answer.value.items);
        return { state: 'linked' } satisfies LinkSaved;
      }
      case 'popup/unlink':
        await forgetLink();
        return { ok: true };
    }
  }

  browser.runtime.onMessage.addListener(
    (raw: unknown, sender: Browser.runtime.MessageSender, respond: (answer: unknown) => void) => {
      if (sender.id !== browser.runtime.id) return false;
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
    void restrictToTrustedContexts();
    void syncWatchScript();
    void rebuildMenu([]);
  });
  browser.runtime.onStartup.addListener(() => {
    void restrictToTrustedContexts();
    void syncWatchScript();
  });
  browser.permissions.onAdded.addListener(() => {
    void syncWatchScript();
  });
  browser.permissions.onRemoved.addListener(() => {
    void syncWatchScript();
  });
});
