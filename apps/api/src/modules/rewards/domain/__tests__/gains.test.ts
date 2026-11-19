import { PayPeriodSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { gainsOf, reportOf, takenBackOf, type GamePay, type GameShift, type HeldGain } from '../gains';
import { levelSteps } from '../levels';

const ZONE = 'Europe/Paris';
const NOW = new Date('2026-11-20T12:00:00Z');
const HOUR = 3_600_000;

const NO_PAY: GamePay = {
  sales: 0,
  dayNetsMinor: [],
  closedPeriodNetsMinor: [],
  tiers: [],
  cumulatedNetMinor: 0,
};
const STEPS = levelSteps([100_000, 500_000, 2_000_000]);

/** A shift ended at `end`, its report handed in `afterHours` later (`null`: never). */
const shift = (end: string, afterHours: number | null): GameShift => {
  const endsAt = new Date(end);
  return { endsAt, reportedAt: afterHours === null ? null : new Date(endsAt.getTime() + afterHours * HOUR) };
};

const kinds = (pay: GamePay, shifts: GameShift[] = [], steps = STEPS) =>
  gainsOf({ pay, shifts, now: NOW, agencyZone: ZONE, levelSteps: steps }).gains.map((gain) =>
    gain.scopeKey === '' ? gain.kind : `${gain.kind}:${gain.scopeKey}`,
  );

describe('reportOf (ADR 0104 § 13)', () => {
  it('is on time until twelve hours after the end, late after', () => {
    expect(reportOf(shift('2026-11-10T20:00:00Z', 0.5), NOW)).toBe('on_time');
    expect(reportOf(shift('2026-11-10T20:00:00Z', 12), NOW)).toBe('on_time');
    expect(reportOf(shift('2026-11-10T20:00:00Z', 12.1), NOW)).toBe('late');
  });

  it('is pending while the report may still come on time, missing after', () => {
    expect(reportOf(shift('2026-11-20T06:00:00Z', null), NOW)).toBe('pending');
    expect(reportOf(shift('2026-11-19T20:00:00Z', null), NOW)).toBe('missing');
  });
});

describe('gainsOf (ADR 0104 § 12 and § 15)', () => {
  it('gives nothing to a member with no fact', () => {
    expect(gainsOf({ pay: NO_PAY, shifts: [], now: NOW, agencyZone: ZONE, levelSteps: STEPS })).toEqual({
      gains: [],
      streak: { current: 0, best: 0 },
    });
  });

  it('gives the first sale, and a record only once a day or a fortnight beat one before it', () => {
    expect(kinds({ ...NO_PAY, sales: 1, dayNetsMinor: [5_000] })).toEqual(['first_sale']);
    expect(kinds({ ...NO_PAY, sales: 3, dayNetsMinor: [5_000, 4_000, 5_000] })).toEqual(['first_sale']);
    expect(kinds({ ...NO_PAY, sales: 3, dayNetsMinor: [5_000, 4_000, 5_001] })).toEqual([
      'first_sale',
      'day_record',
    ]);
    expect(kinds({ ...NO_PAY, sales: 2, closedPeriodNetsMinor: [90_000, 120_000] })).toEqual([
      'first_sale',
      'fortnight_record',
    ]);
  });

  it('writes a tier once a fortnight and threshold', () => {
    const period = PayPeriodSchema.parse('2026-11-01');
    expect(kinds({ ...NO_PAY, tiers: [{ period, thresholdMinor: 100_000 }] })).toEqual([
      'tier:2026-11-01:100000',
    ]);
  });

  it('counts the streak on the reports on time and gives its trophies on the best', () => {
    const days = ['01', '02', '03', '04', '05', '06'];
    const held = days.map((day) => shift(`2026-11-${day}T20:00:00Z`, 1));
    const { gains, streak } = gainsOf({
      pay: NO_PAY,
      shifts: [...held, shift('2026-11-07T20:00:00Z', 20), shift('2026-11-18T20:00:00Z', 1)],
      now: NOW,
      agencyZone: ZONE,
      levelSteps: STEPS,
    });
    expect(streak).toEqual({ current: 1, best: 6 });
    expect(gains.map((gain) => gain.kind)).toEqual(['streak_5']);
  });

  it('gives the fortnight on time for a fortnight ended with every report on time', () => {
    const first = [shift('2026-11-03T20:00:00Z', 1), shift('2026-11-10T20:00:00Z', 2)];
    expect(kinds(NO_PAY, first)).toEqual(['fortnight_on_time']);
    expect(kinds(NO_PAY, [...first, shift('2026-11-12T20:00:00Z', null)])).toEqual([]);
    // The fortnight under way proves nothing yet.
    expect(kinds(NO_PAY, [shift('2026-11-17T20:00:00Z', 1)])).toEqual([]);
  });

  it('gives every rank the cumulated net has reached, and none without thresholds (§ 16)', () => {
    expect(kinds({ ...NO_PAY, cumulatedNetMinor: 99_999 })).toEqual([]);
    expect(kinds({ ...NO_PAY, cumulatedNetMinor: 500_000 })).toEqual(['level:1', 'level:2']);
    expect(kinds({ ...NO_PAY, cumulatedNetMinor: 9_000_000 }, [], [])).toEqual([]);
  });
});

describe('takenBackOf (ADR 0118 § 5 and § 7)', () => {
  const held = (kind: HeldGain['kind'], scopeKey = '', basisMinor: number | null = null): HeldGain => ({
    kind,
    scopeKey,
    basisMinor,
  });
  const earnedWith = (pay: GamePay, steps = STEPS) =>
    gainsOf({ pay, shifts: [], now: NOW, agencyZone: ZONE, levelSteps: steps }).gains;
  const keys = (gains: readonly HeldGain[]) =>
    gains.map((gain) => (gain.scopeKey === '' ? gain.kind : `${gain.kind}:${gain.scopeKey}`));

  it('takes nothing back while the facts still give every gain held', () => {
    const pay = { ...NO_PAY, sales: 2, dayNetsMinor: [1_000, 2_000], cumulatedNetMinor: 120_000 };
    expect(
      takenBackOf({
        held: [held('first_sale'), held('day_record'), held('level', '1', 100_000)],
        earned: earnedWith(pay),
        cumulatedNetMinor: pay.cumulatedNetMinor,
      }),
    ).toEqual([]);
  });

  it('takes back the trophies of a net and the tier that the corrected net no longer gives', () => {
    const period = PayPeriodSchema.parse('2026-11-01');
    const all = [
      held('first_sale'),
      held('day_record'),
      held('fortnight_record'),
      held('tier', `${period}:50000`),
    ];
    expect(keys(takenBackOf({ held: all, earned: earnedWith(NO_PAY), cumulatedNetMinor: 0 }))).toEqual([
      'first_sale',
      'day_record',
      'fortnight_record',
      `tier:${period}:50000`,
    ]);
    // The tier its statement still reaches stays, whatever else left.
    const pay = { ...NO_PAY, tiers: [{ period, thresholdMinor: 50_000 }] };
    expect(keys(takenBackOf({ held: all, earned: earnedWith(pay), cumulatedNetMinor: 0 }))).not.toContain(
      `tier:${period}:50000`,
    );
  });

  it('never takes back what rewards regularity, even with no fact left', () => {
    const regular = [
      held('fortnight_on_time'),
      held('streak_5'),
      held('streak_10'),
      held('streak_25'),
      held('ten_ppv_shift'),
    ];
    expect(takenBackOf({ held: regular, earned: [], cumulatedNetMinor: 0 })).toEqual([]);
  });

  it('takes a rank back when the net falls under the threshold it was reached at: a rank can come down', () => {
    const pay = { ...NO_PAY, cumulatedNetMinor: 99_999 };
    const ranks = [held('level', '1', 100_000), held('level', '2', 500_000)];
    expect(
      keys(takenBackOf({ held: ranks, earned: earnedWith(pay), cumulatedNetMinor: pay.cumulatedNetMinor })),
    ).toEqual(['level:1', 'level:2']);
    const between = { ...NO_PAY, cumulatedNetMinor: 300_000 };
    expect(
      keys(
        takenBackOf({
          held: ranks,
          earned: earnedWith(between),
          cumulatedNetMinor: between.cumulatedNetMinor,
        }),
      ),
    ).toEqual(['level:2']);
  });

  it('keeps a rank when only the thresholds moved: raised, emptied, or lowered under a net that fell', () => {
    const rank = [held('level', '1', 100_000)];
    const pay = { ...NO_PAY, cumulatedNetMinor: 150_000 };
    // Raised above a net that did not move.
    expect(
      takenBackOf({ held: rank, earned: earnedWith(pay, levelSteps([900_000])), cumulatedNetMinor: 150_000 }),
    ).toEqual([]);
    // Emptied.
    expect(takenBackOf({ held: rank, earned: earnedWith(pay, []), cumulatedNetMinor: 150_000 })).toEqual([]);
    // Lowered: the net fell under the old threshold, today's still gives the rank.
    const fallen = { ...NO_PAY, cumulatedNetMinor: 60_000 };
    expect(
      takenBackOf({
        held: rank,
        earned: earnedWith(fallen, levelSteps([50_000])),
        cumulatedNetMinor: 60_000,
      }),
    ).toEqual([]);
  });

  it('takes back a rank whose net fell under its threshold even once the thresholds are emptied', () => {
    expect(
      keys(takenBackOf({ held: [held('level', '1', 100_000)], earned: [], cumulatedNetMinor: 40_000 })),
    ).toEqual(['level:1']);
  });

  it('keeps a rank noted before its threshold was kept', () => {
    expect(takenBackOf({ held: [held('level', '1', null)], earned: [], cumulatedNetMinor: 0 })).toEqual([]);
  });

  it('notes with a rank the threshold it is reached at', () => {
    expect(earnedWith({ ...NO_PAY, cumulatedNetMinor: 100_000 })).toEqual([
      { kind: 'level', scopeKey: '1', basisMinor: 100_000 },
    ]);
  });
});
