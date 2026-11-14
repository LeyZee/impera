import { describe, expect, it } from 'vitest';

import { shiftChallenge, shownShift, type ChallengeShift, type TimedNet } from '../challenge';

const ZONE = 'Europe/Paris';
const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;

/** Monday 14 December 2026: the four Mondays before it are in winter time too (UTC+1). */
const DECEMBER = Date.UTC(2026, 11, 14);
/** Monday 9 November 2026: three weeks before it, Paris is still in summer time (UTC+2). */
const NOVEMBER = Date.UTC(2026, 10, 9);

/** A Monday shift of four hours, `weeksBefore` weeks before `base`; 19:00 UTC is 20:00 in Paris in winter. */
const monday = (weeksBefore: number, startHourUtc = 19, base = DECEMBER): ChallengeShift => {
  const startsAt = new Date(base + startHourUtc * HOUR - weeksBefore * WEEK);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 4 * HOUR) };
};

const sale = (shift: ChallengeShift, netMinor: number, afterMinutes = 30): TimedNet => ({
  at: new Date(shift.startsAt.getTime() + afterMinutes * 60_000),
  netMinor,
});

describe('shiftChallenge (ADR 0104 § 14)', () => {
  const today = monday(0);
  const past = [monday(1), monday(2), monday(3), monday(4)];
  const history = [
    sale(past[0]!, 10_000),
    sale(past[1]!, 20_000),
    sale(past[2]!, 30_000),
    sale(past[3]!, 40_000),
  ];

  it('aims at the median of the same weekday and slot, and counts the shift under way', () => {
    expect(
      shiftChallenge({ shift: today, past, nets: [...history, sale(today, 12_000)], agencyZone: ZONE }),
    ).toEqual({ targetMinor: 25_000, netMinor: 12_000, met: false });
  });

  it('is met when the net of the shift reaches the target, refunds taken off', () => {
    const nets = [...history, sale(today, 30_000), sale(today, -4_000, 60)];
    expect(shiftChallenge({ shift: today, past, nets, agencyZone: ZONE })?.met).toBe(true);
    expect(shiftChallenge({ shift: today, past, nets, agencyZone: ZONE })?.netMinor).toBe(26_000);
  });

  it('has no challenge under four comparable shifts', () => {
    expect(
      shiftChallenge({ shift: today, past: past.slice(0, 3), nets: history, agencyZone: ZONE }),
    ).toBeNull();
  });

  it('does not compare another weekday, another slot, or a shift older than eight weeks', () => {
    const tuesday: ChallengeShift = {
      startsAt: new Date(past[3]!.startsAt.getTime() + 24 * HOUR),
      endsAt: new Date(past[3]!.endsAt.getTime() + 24 * HOUR),
    };
    const others = [...past.slice(0, 3), tuesday, monday(5, 9), monday(9)];
    expect(shiftChallenge({ shift: today, past: others, nets: history, agencyZone: ZONE })).toBeNull();
  });

  it('keeps the slot across a clock change: 20:00 in Paris in summer and in winter', () => {
    // 19 October 2026 and the Mondays before it are in summer time: 20:00 in Paris is 18:00 UTC.
    const winter = monday(0, 19, NOVEMBER);
    const summer = [3, 4, 5, 6].map((weeks) => monday(weeks, 18, NOVEMBER));
    const nets = summer.map((shift) => sale(shift, 10_000));
    expect(shiftChallenge({ shift: winter, past: summer, nets, agencyZone: ZONE })?.targetMinor).toBe(10_000);
  });

  it('counts a sale at the start and not one at the end', () => {
    const nets = [...history, { at: today.startsAt, netMinor: 5_000 }, { at: today.endsAt, netMinor: 9_000 }];
    expect(shiftChallenge({ shift: today, past, nets, agencyZone: ZONE })?.netMinor).toBe(5_000);
  });
});

describe('shownShift', () => {
  const shift = monday(0);
  const at = (hoursAfterStart: number) => new Date(shift.startsAt.getTime() + hoursAfterStart * HOUR);

  it('is the shift under way, then the last one for twelve hours after its end', () => {
    expect(shownShift([monday(1), shift], at(1))).toBe(shift);
    expect(shownShift([monday(1), shift], at(15))).toBe(shift);
    expect(shownShift([monday(1), shift], at(16))).toBeNull();
  });

  it('is none before the first shift begins', () => {
    expect(shownShift([shift], at(-1))).toBeNull();
    expect(shownShift([], at(0))).toBeNull();
  });
});
