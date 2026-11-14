import { effectiveCaps, NO_CAPS, type CapDefaults, type StoredCaps } from '../domain/budget';

/** The API and the worker each hold a copy: the other's change reaches it within this time. */
const CAPS_REFRESH_MS = 60_000;

export interface CapsCache {
  /** Read by the gateway before each call: never waits on the database. */
  dailyCapEur(): number;
  trendWatchCapEur(): number;
  /** What the cache holds now, for the screen. */
  current(): StoredCaps;
  /** After a write in this process: applies at once, without waiting for the next refresh. */
  set(caps: StoredCaps): void;
  /**
   * The first read, awaited at start so the first call already uses the owner's values. It rejects when the read
   * fails: starting on the code's defaults could lift a lower cap set by the owner, so the process does not start.
   */
  load(): Promise<void>;
}

export interface CapsCacheDeps {
  readonly read: () => Promise<StoredCaps>;
  readonly defaults: CapDefaults;
  readonly now: () => number;
  readonly onError: (error: unknown) => void;
  readonly refreshEveryMs?: number;
}

/**
 * The owner's caps in memory, refreshed in the background at most every minute. A failed read keeps the last value
 * known (the first read, `load`, must succeed): the cap is never lifted because the database is slow.
 */
export function createCapsCache(deps: CapsCacheDeps): CapsCache {
  const every = deps.refreshEveryMs ?? CAPS_REFRESH_MS;
  let caps: StoredCaps = NO_CAPS;
  let readAt = Number.NEGATIVE_INFINITY;
  let pending: Promise<void> | null = null;
  /** Bumped by `set`: a read started before a write never brings the old values back. */
  let written = 0;

  const store = (at: number, next: StoredCaps): void => {
    if (at === written) caps = next;
  };
  const refresh = (): Promise<void> => {
    const at = written;
    pending ??= deps
      .read()
      .then(
        (next) => {
          store(at, next);
        },
        (error: unknown) => {
          deps.onError(error);
        },
      )
      .finally(() => {
        readAt = deps.now();
        pending = null;
      });
    return pending;
  };
  const fresh = (): StoredCaps => {
    if (deps.now() - readAt >= every) void refresh();
    return caps;
  };

  return {
    dailyCapEur: () => effectiveCaps(fresh(), deps.defaults).dailyCapMinor / 100,
    trendWatchCapEur: () => effectiveCaps(fresh(), deps.defaults).trendWatchCapMinor / 100,
    current: () => caps,
    set(next) {
      written += 1;
      caps = next;
      readAt = deps.now();
    },
    async load() {
      const at = written;
      store(at, await deps.read());
      readAt = deps.now();
    },
  };
}
