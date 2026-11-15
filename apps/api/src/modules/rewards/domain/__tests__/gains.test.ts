import { PayPeriodSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { gainsOf, reportOf, type GamePay, type GameShift } from '../gains';

const ZONE = 'Europe/Paris';
const NOW = new Date('2026-11-20T12:00:00Z');
const HOUR = 3_600_000;

const NO_PAY: GamePay = { sales: 0, dayNetsMinor: [], closedPeriodNetsMinor: [], tiers: [] };

/** A shift ended at `end`, its report handed in `afterHours` later (`null`: never). */
const shift = (end: string, afterHours: number | null): GameShift => {
  const endsAt = new Date(end);
  return { endsAt, reportedAt: afterHours === null ? null : new Date(endsAt.getTime() + afterHours * HOUR) };
};

const kinds = (pay: GamePay, shifts: GameShift[] = []) =>
  gainsOf({ pay, shifts, now: NOW, agencyZone: ZONE }).gains.map((gain) =>
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
    expect(gainsOf({ pay: NO_PAY, shifts: [], now: NOW, agencyZone: ZONE })).toEqual({
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
});
