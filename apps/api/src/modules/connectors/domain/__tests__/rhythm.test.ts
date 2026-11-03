import { ConnectorConfigSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { afterFailure, isPaused, nextPollAt, type BreakerState } from '../rhythm';

const CONFIG = ConnectorConfigSchema.parse({});
const NOW = new Date('2026-10-17T20:00:00.000Z');

describe('nextPollAt', () => {
  it('polls a new account right away, give or take the jitter', () => {
    expect(nextPollAt(null, CONFIG, NOW, 0)).toEqual(NOW);
    expect(nextPollAt(null, CONFIG, NOW, 0.999).getTime() - NOW.getTime()).toBe(20_000);
  });

  it('waits the interval plus the jitter after the last poll', () => {
    const last = new Date(NOW.getTime() - 10_000);
    expect(nextPollAt(last, CONFIG, NOW, 0.5).getTime()).toBe(last.getTime() + 60_000 + 10_000);
  });

  it('never schedules in the past', () => {
    const longAgo = new Date(NOW.getTime() - 3_600_000);
    expect(nextPollAt(longAgo, CONFIG, NOW, 0)).toEqual(NOW);
  });
});

describe('circuit breaker', () => {
  it('counts failures and opens at the threshold for the configured pause', () => {
    let state: BreakerState = { consecutiveErrors: 0, pausedUntil: null };
    for (let failure = 1; failure < CONFIG.breakerThreshold; failure += 1) {
      const next = afterFailure(state, CONFIG, NOW);
      expect(next).toMatchObject({ consecutiveErrors: failure, pausedUntil: null, opened: false });
      state = next;
    }
    const opened = afterFailure(state, CONFIG, NOW);
    expect(opened.opened).toBe(true);
    expect(opened.consecutiveErrors).toBe(0);
    expect(opened.pausedUntil?.getTime()).toBe(NOW.getTime() + 10 * 60_000);
    expect(isPaused(opened, NOW)).toBe(true);
    expect(isPaused(opened, new Date(NOW.getTime() + 10 * 60_000))).toBe(false);
  });
});
