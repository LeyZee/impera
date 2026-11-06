import type { InstagramPostCode } from '@impera/contracts';

import type { SeenPost } from './protocol';
import type { PostSnapshot } from './reader';

const MAX_DWELL_MS = 45 * 60_000;

interface Entry {
  snapshot: PostSnapshot;
  seenAt: string;
  dwellMs: number;
  /** When it came on screen, while it is; null while it is not. */
  shownSince: number | null;
  dirty: boolean;
}

/**
 * The posts the reader saw in one watch session (VEI-02), each by its code whatever the page it was seen on: what
 * each reading added (a value read once is not lost when a later page does not show it), and the time it stayed on
 * screen. `drain` hands over the posts that changed since the last call.
 */
export class SeenLedger {
  private readonly entries = new Map<InstagramPostCode, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  get size(): number {
    return this.entries.size;
  }

  record(snapshot: PostSnapshot): void {
    const entry = this.entries.get(snapshot.code);
    if (entry === undefined) {
      this.entries.set(snapshot.code, {
        snapshot,
        seenAt: new Date(this.now()).toISOString(),
        dwellMs: 0,
        shownSince: null,
        dirty: true,
      });
      return;
    }
    const merged = merge(entry.snapshot, snapshot);
    if (!sameSnapshot(merged, entry.snapshot)) {
      entry.snapshot = merged;
      entry.dirty = true;
    }
  }

  /** The posts on screen now; the others stop counting their time. */
  showing(codes: ReadonlySet<InstagramPostCode>): void {
    const at = this.now();
    for (const [code, entry] of this.entries) {
      const shown = codes.has(code);
      if (shown && entry.shownSince === null) entry.shownSince = at;
      if (!shown && entry.shownSince !== null) {
        this.addDwell(entry, at - entry.shownSince);
        entry.shownSince = null;
        entry.dirty = true;
      }
    }
  }

  snapshotOf(code: InstagramPostCode): SeenPost | null {
    const entry = this.entries.get(code);
    return entry === undefined ? null : this.seenOf(entry, this.now());
  }

  /** The posts that changed since the last call, their time on screen counted up to now. */
  drain(limit = 50): readonly SeenPost[] {
    const at = this.now();
    const out: SeenPost[] = [];
    for (const entry of this.entries.values()) {
      if (entry.shownSince !== null) {
        const before = entry.dwellMs;
        this.addDwell(entry, at - entry.shownSince);
        entry.shownSince = at;
        if (entry.dwellMs !== before) entry.dirty = true;
      }
      if (!entry.dirty || out.length >= limit) continue;
      out.push(this.seenOf(entry, at));
      entry.dirty = false;
    }
    return out;
  }

  private addDwell(entry: Entry, ms: number): void {
    entry.dwellMs = Math.min(MAX_DWELL_MS, entry.dwellMs + Math.max(0, Math.round(ms)));
  }

  private seenOf(entry: Entry, at: number): SeenPost {
    const running = entry.shownSince === null ? 0 : at - entry.shownSince;
    return {
      ...entry.snapshot,
      hashtags: [...entry.snapshot.hashtags],
      dwellMs: Math.min(MAX_DWELL_MS, entry.dwellMs + Math.max(0, Math.round(running))),
      seenAt: entry.seenAt,
    };
  }
}

function merge(known: PostSnapshot, read: PostSnapshot): PostSnapshot {
  return {
    code: known.code,
    // A post seen as a reel anywhere stays a reel.
    path: known.path === 'reel' || read.path === 'reel' ? 'reel' : 'post',
    account: read.account ?? known.account,
    metrics: {
      views: read.metrics.views ?? known.metrics.views,
      likes: read.metrics.likes ?? known.metrics.likes,
      comments: read.metrics.comments ?? known.metrics.comments,
    },
    caption: read.caption ?? known.caption,
    hashtags: read.hashtags.length > 0 ? read.hashtags : known.hashtags,
    sound: read.sound ?? known.sound,
    soundId: read.soundId ?? known.soundId,
  };
}

function sameSnapshot(a: PostSnapshot, b: PostSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
