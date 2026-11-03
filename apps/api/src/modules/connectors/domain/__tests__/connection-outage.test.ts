import { describe, expect, it } from 'vitest';

import {
  connectionServiceOf,
  isLastingOutage,
  nextUnreachableRun,
  OUTAGE_AFTER_MS,
} from '../connection-outage';

describe('an unreachable sales register (Telegram P3-12)', () => {
  const start = new Date('2026-11-03T08:00:00Z');
  const at = (ms: number) => new Date(start.getTime() + ms);

  it('is an outage after three failed reads over a quarter of an hour, not before', () => {
    let run = nextUnreachableRun(null, start);
    expect(run).toEqual({ since: start, reads: 1 });
    run = nextUnreachableRun(run, at(OUTAGE_AFTER_MS));
    // Two reads: a quarter of an hour is not enough alone.
    expect(isLastingOutage(run, at(OUTAGE_AFTER_MS))).toBe(false);
    run = nextUnreachableRun(run, at(60_000));
    expect(isLastingOutage(run, at(OUTAGE_AFTER_MS - 1))).toBe(false);
    expect(isLastingOutage(run, at(OUTAGE_AFTER_MS))).toBe(true);
  });

  it('names Reveal’s register, and no other platform', () => {
    expect(connectionServiceOf('reveal')).toBe('reveal_crm');
    expect(connectionServiceOf('onlyfans')).toBeNull();
  });
});
