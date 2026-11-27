import type { TimeWasterSetting } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { slowedReplyAt, timeWasterLevel } from '../attention';

// Invented values for the tests: the agency's own are entered in the CRM, never written in the repository.
const SETTING: TimeWasterSetting = {
  minUnenteredScripts: 3,
  provenHours: 100,
  slowedDelayMinutes: { min: 60, max: 180 },
  dormantDelayMinutes: { min: 300, max: 600 },
  slowedRepliesPerDay: 2,
  dormantRepliesPerDay: 1,
};

describe('timeWasterLevel (ADR 0135, Charles 26/11 and 27/11)', () => {
  const free = { protectedFan: false, unenteredScripts: 1, minUnenteredScripts: 1, distinctSigns: 0 };

  it('answers payers and new fans as usual', () => {
    expect(timeWasterLevel({ ...free, standing: 'payer' })).toBeNull();
    expect(timeWasterLevel({ ...free, standing: 'new' })).toBeNull();
  });

  it('slows the one who hesitates', () => {
    expect(timeWasterLevel({ ...free, standing: 'time_waster' })).toBe('slowed');
    expect(timeWasterLevel({ ...free, standing: 'proven_time_waster' })).toBe('slowed');
  });

  it('answers rarely only three times the scripts refused and two different signs', () => {
    const tiresome = { ...free, standing: 'time_waster' as const, unenteredScripts: 3, distinctSigns: 2 };
    expect(timeWasterLevel(tiresome)).toBe('dormant');
    expect(timeWasterLevel({ ...tiresome, unenteredScripts: 2 })).toBe('slowed');
    expect(timeWasterLevel({ ...tiresome, distinctSigns: 1 })).toBe('slowed');
    expect(timeWasterLevel({ ...tiresome, minUnenteredScripts: 2, unenteredScripts: 5 })).toBe('slowed');
  });

  it('brings the tiresome one back to slowed when he apologises', () => {
    const tiresome = { ...free, standing: 'time_waster' as const, unenteredScripts: 3, distinctSigns: 2 };
    expect(timeWasterLevel({ ...tiresome, apologised: true })).toBe('slowed');
  });

  it('never touches a protected fan', () => {
    expect(
      timeWasterLevel({
        ...free,
        standing: 'time_waster',
        unenteredScripts: 9,
        distinctSigns: 4,
        protectedFan: true,
      }),
    ).toBeNull();
  });
});

describe('slowedReplyAt (ADR 0135 § 6)', () => {
  const since = new Date('2026-11-26T20:00:00Z');
  const base = {
    level: 'slowed' as const,
    waitingSince: since,
    repliesToday: 0,
    nextDayStart: new Date('2026-11-27T08:00:00Z'),
    seed: 'conversation-1:2026-11-26T20:00:00Z',
    setting: SETTING,
  };
  const minutesAfter = (at: Date | null) => (at === null ? null : (at.getTime() - since.getTime()) / 60_000);

  it('waits a drawn delay in the range of his level, the same for the same wait', () => {
    const at = slowedReplyAt({ ...base, now: since });
    expect(minutesAfter(at)).toBeGreaterThanOrEqual(60);
    expect(minutesAfter(at)).toBeLessThanOrEqual(180);
    expect(slowedReplyAt({ ...base, now: new Date(since.getTime() + 60_000) })).toEqual(at);
    const dormant = slowedReplyAt({ ...base, level: 'dormant', now: since });
    expect(minutesAfter(dormant)).toBeGreaterThanOrEqual(300);
    expect(minutesAfter(dormant)).toBeLessThanOrEqual(600);
  });

  it('draws differently from one wait to another', () => {
    const delays = new Set(
      Array.from({ length: 12 }, (_, i) =>
        minutesAfter(slowedReplyAt({ ...base, seed: `c:${String(i)}`, now: since })),
      ),
    );
    expect(delays.size).toBeGreaterThan(1);
  });

  it('lets her answer once the wait is over', () => {
    expect(slowedReplyAt({ ...base, now: new Date(since.getTime() + 181 * 60_000) })).toBeNull();
  });

  it('moves to her next day once her answers of the day are spent', () => {
    const at = slowedReplyAt({ ...base, repliesToday: 2, now: new Date(since.getTime() + 181 * 60_000) });
    expect(at?.getTime()).toBeGreaterThanOrEqual(base.nextDayStart.getTime());
    expect(
      slowedReplyAt({ ...base, level: 'dormant', repliesToday: 1, now: since })?.getTime(),
    ).toBeGreaterThanOrEqual(base.nextDayStart.getTime());
  });
});
