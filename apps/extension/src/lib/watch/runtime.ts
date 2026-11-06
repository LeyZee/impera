import type { InstagramPostCode } from '@impera/contracts';

import { SeenLedger } from './ledger';
import { watchPageOf, type WatchPage } from './pages';
import type { FromReader, OnScreen } from './protocol';
import {
  isEmptySnapshot,
  isPrivateProfile,
  postRootOf,
  readPost,
  readTile,
  reelRootOf,
  tilesOf,
  type PostSnapshot,
} from './reader';

/**
 * The reader's life on an instagram.com tab (VEI-02, ADR 0060 § 2, source 6). It only watches: a MutationObserver
 * and an IntersectionObserver on what the page already shows, the address read every half second. It never scrolls,
 * clicks, opens, requests, injects a node or a style, nor fires an event the page could hear; the service worker does
 * every send.
 */

/** Amber when posts are on a read page and nothing of them is read for this long. */
export const AMBER_AFTER_MS = 20_000;
const SCAN_DEBOUNCE_MS = 400;
const ADDRESS_POLL_MS = 500;
const SEND_EVERY_MS = 5_000;
/** A tile counts as on screen from this share of it visible. */
const VISIBLE_RATIO = 0.6;

export interface ReaderDeps {
  readonly document: Document;
  readonly location: { readonly pathname: string };
  readonly send: (message: FromReader) => void;
  readonly now?: () => number;
}

export class WatchReader {
  private ledger: SeenLedger;
  private readonly now: () => number;
  private watching = false;
  private page: WatchPage | null = null;
  private path = '';
  private current: InstagramPostCode | null = null;
  private readonly ratios = new WeakMap<Element, number>();
  private readonly tileCodes = new WeakMap<Element, InstagramPostCode>();
  private observed = new Set<Element>();
  private mutations: MutationObserver | null = null;
  private visibility: IntersectionObserver | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private emptySince: number | null = null;
  private amber = false;

  constructor(private readonly deps: ReaderDeps) {
    this.now = deps.now ?? Date.now;
    this.ledger = new SeenLedger(this.now);
  }

  get isWatching(): boolean {
    return this.watching;
  }

  start(): void {
    if (this.watching) return;
    this.watching = true;
    this.ledger = new SeenLedger(this.now);
    const doc = this.deps.document;
    this.mutations = new MutationObserver(() => {
      this.scheduleScan();
    });
    this.mutations.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
    this.visibility = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) this.ratios.set(entry.target, entry.intersectionRatio);
        this.updateShowing();
      },
      { threshold: [0, 0.25, 0.5, VISIBLE_RATIO, 0.75, 1] },
    );
    this.timers = [
      setInterval(() => {
        if (this.deps.location.pathname !== this.path) this.scan();
      }, ADDRESS_POLL_MS),
      setInterval(() => {
        // Read again even when the page is still, so that a page that stopped showing anything turns amber.
        this.scan();
        this.flush();
      }, SEND_EVERY_MS),
    ];
    this.scan();
  }

  stop(): void {
    if (!this.watching) return;
    this.flush();
    this.watching = false;
    this.mutations?.disconnect();
    this.visibility?.disconnect();
    for (const timer of this.timers) clearInterval(timer);
    if (this.scanTimer !== null) clearTimeout(this.scanTimer);
    this.timers = [];
    this.observed = new Set();
    this.mutations = null;
    this.visibility = null;
    this.scanTimer = null;
    this.current = null;
    this.setAmber(false);
  }

  /** Sends what changed: every few seconds, when the tab is left (`pagehide`), and when the watch stops. */
  flush(): void {
    if (!this.watching) return;
    for (let posts = this.ledger.drain(); posts.length > 0; posts = this.ledger.drain()) {
      this.deps.send({ type: 'watch/seen', posts: [...posts] });
    }
  }

  /** The post shown whole on screen now, with its video's length; null on a grid or while nothing shows. */
  onScreen(): OnScreen | null {
    if (!this.watching) return null;
    this.scan();
    if (this.current === null) return null;
    const post = this.ledger.snapshotOf(this.current);
    if (post === null) return null;
    const video = this.mostVisibleVideo();
    const duration = video?.duration;
    return {
      post,
      durationS:
        duration !== undefined && Number.isFinite(duration) && duration > 0
          ? Math.min(3_600, duration)
          : null,
    };
  }

  private scheduleScan(): void {
    if (this.scanTimer !== null) return;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      this.scan();
    }, SCAN_DEBOUNCE_MS);
  }

  scan(): void {
    if (!this.watching) return;
    const doc = this.deps.document;
    this.path = this.deps.location.pathname;
    this.page = watchPageOf(this.path);
    this.current = null;
    const page = this.page;
    if (page === null || (page.kind === 'profile' && isPrivateProfile(doc))) {
      this.updateShowing();
      this.health([], false);
      return;
    }
    const read: PostSnapshot[] = [];
    if (page.kind === 'post') {
      const root = postRootOf(doc, page.code);
      if (root !== null) read.push(readPost(root, page));
      this.current = page.code;
    } else if (page.kind === 'reels') {
      for (const video of Array.from(doc.querySelectorAll('main video'))) this.observe(video);
      const video = this.mostVisibleVideo();
      const root = video === null ? null : reelRootOf(video);
      if (page.code !== null && root !== null) read.push(readPost(root, { code: page.code, path: 'reel' }));
      this.current = page.code;
    } else {
      for (const tile of tilesOf(doc)) {
        const snapshot = readTile(tile, page);
        if (snapshot === null) continue;
        this.tileCodes.set(tile, snapshot.code);
        this.observe(tile);
        read.push(snapshot);
      }
    }
    for (const snapshot of read) this.ledger.record(snapshot);
    if (this.current !== null && this.ledger.snapshotOf(this.current) === null && read.length === 0) {
      // The address names a post the page does not hold yet: counted as seen, read when it shows.
      this.ledger.record(emptySnapshot(this.current, page.kind === 'post' ? page.path : 'reel'));
    }
    this.updateShowing();
    // Tiles show nothing but their address outside a profile's Reels tab: only a post shown whole can turn amber.
    this.health(page.kind === 'post' || page.kind === 'reels' ? read : [], this.current !== null);
  }

  private observe(element: Element): void {
    if (this.observed.has(element)) return;
    this.observed.add(element);
    this.visibility?.observe(element);
  }

  private mostVisibleVideo(): HTMLVideoElement | null {
    let best: HTMLVideoElement | null = null;
    let bestRatio = 0;
    for (const video of Array.from(this.deps.document.querySelectorAll('main video'))) {
      const ratio = this.ratios.get(video) ?? 0;
      if (ratio > bestRatio && video instanceof HTMLVideoElement) {
        best = video;
        bestRatio = ratio;
      }
    }
    return best;
  }

  private updateShowing(): void {
    const shown = new Set<InstagramPostCode>();
    if (this.deps.document.visibilityState !== 'hidden') {
      if (this.current !== null) shown.add(this.current);
      else
        for (const tile of this.observed) {
          const code = this.tileCodes.get(tile);
          if (code !== undefined && (this.ratios.get(tile) ?? 0) >= VISIBLE_RATIO) shown.add(code);
        }
    }
    this.ledger.showing(shown);
  }

  /** Amber after `AMBER_AFTER_MS` of a post on screen with nothing of it read; back to normal at the first value. */
  private health(read: readonly PostSnapshot[], expectsPost: boolean): void {
    const at = this.now();
    const nothing = expectsPost && (read.length === 0 || read.every(isEmptySnapshot));
    if (!nothing) {
      this.emptySince = null;
      this.setAmber(false);
      return;
    }
    this.emptySince ??= at;
    if (at - this.emptySince >= AMBER_AFTER_MS) this.setAmber(true);
  }

  private setAmber(amber: boolean): void {
    if (amber === this.amber) return;
    this.amber = amber;
    if (this.watching || !amber) this.deps.send({ type: 'watch/health', amber });
  }
}

function emptySnapshot(code: InstagramPostCode, path: 'post' | 'reel'): PostSnapshot {
  return {
    code,
    path,
    account: null,
    metrics: { views: null, likes: null, comments: null },
    caption: null,
    hashtags: [],
    sound: null,
    soundId: null,
  };
}
