import { describe, expect, it, vi } from 'vitest';

import type { StoredCaps } from '../../domain/budget';
import { createCapsCache } from '../caps-cache';

const DEFAULTS = { dailyCapMinor: 2000, trendWatchCapMinor: 100 };
const caps = (dailyCapMinor: number | null, trendWatchCapMinor: number | null = null): StoredCaps => ({
  dailyCapMinor,
  trendWatchCapMinor,
  updatedAt: new Date('2026-11-13T10:00:00Z'),
});

/** A read the test answers by hand. */
function deferredRead() {
  const answers: { resolve: (caps: StoredCaps) => void; reject: (error: unknown) => void }[] = [];
  const read = vi.fn(
    () =>
      new Promise<StoredCaps>((resolve, reject) => {
        answers.push({ resolve, reject });
      }),
  );
  return { read, answers };
}

describe('createCapsCache', () => {
  it('serves the code’s defaults until a value is read, then the owner’s', async () => {
    let now = 0;
    const read = vi.fn(() => Promise.resolve(caps(5000, 50)));
    const cache = createCapsCache({ read, defaults: DEFAULTS, now: () => now, onError: vi.fn() });
    expect(cache.dailyCapEur()).toBe(20);
    await cache.load();
    expect(cache.dailyCapEur()).toBe(50);
    expect(cache.trendWatchCapEur()).toBe(0.5);
    const reads = read.mock.calls.length;
    now = 1000;
    cache.dailyCapEur();
    // Within the minute: the value read at start serves, nothing is read again.
    expect(read).toHaveBeenCalledTimes(reads);
  });

  it('rereads at most once a minute, in the background', async () => {
    let now = 0;
    const read = vi.fn(() => Promise.resolve(caps(5000)));
    const cache = createCapsCache({ read, defaults: DEFAULTS, now: () => now, onError: vi.fn() });
    await cache.load();
    now = 59_999;
    cache.dailyCapEur();
    expect(read).toHaveBeenCalledTimes(1);
    now = 60_000;
    cache.dailyCapEur();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps the last value known when a read fails, never lifting the cap', async () => {
    let now = 0;
    const { read, answers } = deferredRead();
    const onError = vi.fn();
    const cache = createCapsCache({ read, defaults: DEFAULTS, now: () => now, onError });
    const first = cache.load();
    answers[0]?.resolve(caps(500));
    await first;
    now = 60_000;
    expect(cache.dailyCapEur()).toBe(5);
    answers[1]?.reject(new Error('database down'));
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    expect(cache.dailyCapEur()).toBe(5);
  });

  it('never lets a read started before a write bring the old values back', async () => {
    const { read, answers } = deferredRead();
    const cache = createCapsCache({ read, defaults: DEFAULTS, now: () => 0, onError: vi.fn() });
    const loading = cache.load();
    cache.set(caps(9000));
    answers[0]?.resolve(caps(500));
    await loading;
    expect(cache.dailyCapEur()).toBe(90);
  });

  it('refuses to start on the code’s defaults when the first read fails', async () => {
    const read = vi.fn(() => Promise.reject(new Error('database down')));
    const cache = createCapsCache({ read, defaults: DEFAULTS, now: () => 0, onError: vi.fn() });
    await expect(cache.load()).rejects.toThrow('database down');
  });
});
