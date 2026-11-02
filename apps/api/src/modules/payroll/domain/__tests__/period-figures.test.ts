import type { CommissionStatement } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { forecastAtEnd, lateNetOf, periodFigures, periodPace, reachedBpsOf } from '../period-figures';

const WINDOW = { startsAt: '2026-10-31T23:00:00.000Z', endsAt: '2026-11-15T23:00:00.000Z' };
const day = (n: number, hours = 0): Date =>
  new Date(new Date(WINDOW.startsAt).getTime() + (n * 24 + hours) * 3_600_000);

type FigureStatement = Parameters<typeof periodFigures>[0][number];
const figure = (patch: Partial<FigureStatement> = {}): FigureStatement => ({
  status: 'draft',
  carryOverOutMinor: 0,
  netMinor: 8_500,
  payableMinor: 0,
  payment: null,
  ...patch,
});
const paid = (sentMinor: number): FigureStatement['payment'] => ({ sentMinor });
const lateReport = (grossMinor: number) => ({ grossMinor });
const line = (grossMinor: number, netMinor: number, late: readonly number[] = []) => ({
  grossMinor,
  netMinor,
  lateReports: late.map(lateReport),
});
const team = (reachedBps: number | null): CommissionStatement['team'] =>
  reachedBps === null ? null : { netMinor: null, collective: { reachedBps, tier: null } };

describe('the figures of a period (ADR 0047 § 2)', () => {
  it('counts and sums as the list of periods does: only a validation makes an amount owed or carried', () => {
    expect(
      periodFigures([
        figure({ status: 'paid', netMinor: 8_500, payableMinor: 2_125, payment: paid(2_125) }),
        figure({ carryOverOutMinor: 900, payableMinor: 0 }),
        figure({ status: 'validated', carryOverOutMinor: 700, payableMinor: 0 }),
      ]),
    ).toEqual({
      statements: { draft: 1, validated: 1, paid: 1, carried: 1 },
      netMinor: 25_500,
      payableMinor: 2_125,
      validatedPayableMinor: 2_125,
      carriedMinor: 700,
      paidMinor: 2_125,
    });
    expect(periodFigures([])).toEqual({
      statements: { draft: 0, validated: 0, paid: 0, carried: 0 },
      netMinor: 0,
      payableMinor: 0,
      validatedPayableMinor: 0,
      carriedMinor: 0,
      paidMinor: 0,
    });
  });
});

describe('the forecast at the end of a period', () => {
  it('says nothing before a first full day, then follows the pace of the time gone by', () => {
    expect(forecastAtEnd(5_000, 0, WINDOW, day(0, 20))).toBeNull();
    // Five days of fifteen gone: three times what is made.
    expect(forecastAtEnd(100_000, 0, WINDOW, day(5))).toBe(300_000);
    expect(forecastAtEnd(0, 0, WINDOW, day(7))).toBe(0);
  });

  it('is the figure itself once the period has ended', () => {
    expect(forecastAtEnd(123_456, 20_000, WINDOW, day(15))).toBe(123_456);
    expect(forecastAtEnd(123_456, 0, WINDOW, day(20))).toBe(123_456);
  });

  it('counts a report validated late once, never as pace', () => {
    expect(forecastAtEnd(13_000, 3_000, WINDOW, day(5))).toBe(33_000);
  });

  it('reads the late share of each line from its gross, onto its net', () => {
    expect(lateNetOf([{ lines: [line(10_000, 8_000, [2_500]), line(10_000, 8_000)] }])).toBe(2_000);
    expect(lateNetOf([])).toBe(0);
  });

  it('floors a share of the target as the engine does', () => {
    expect(reachedBpsOf(99_999, 100_000)).toBe(9_999);
    expect(reachedBpsOf(-5_000, 100_000)).toBe(0);
  });
});

describe('where a period is heading', () => {
  const goal = { targetMinor: 100_000 };

  it('gives the agency the late net, the forecast net, and the goal from the frozen share else the net', () => {
    const statements = [
      { lines: [line(16_250, 13_000, [3_750])], team: { netMinor: 13_000, collective: null } },
    ];
    expect(
      periodPace({
        statements,
        figures: { netMinor: 13_000 },
        window: WINDOW,
        goal,
        self: false,
        team: { netMinor: 13_000, lateNetMinor: 3_000 },
        now: day(5),
      }),
    ).toEqual({
      lateNetMinor: 3_000,
      forecastNetMinor: 33_000,
      goal: { reachedBps: 1_300, forecastReachedBps: 3_300 },
    });
    expect(
      periodPace({
        statements: [
          { lines: [], team: { netMinor: 85_000, collective: { reachedBps: 8_500, tier: null } } },
        ],
        figures: { netMinor: 85_000 },
        window: WINDOW,
        goal,
        self: false,
        team: { netMinor: 85_000, lateNetMinor: 0 },
        now: day(20),
      }).goal,
    ).toEqual({ reachedBps: 8_500, forecastReachedBps: 8_500 });
  });

  it('gives a member the same forecast of the goal as the agency, late reports set apart, and never a net (ok A)', () => {
    const pace = periodPace({
      statements: [{ lines: [line(5_000, 4_000)], team: team(1_300) }],
      figures: { netMinor: 4_000 },
      window: WINDOW,
      goal,
      self: true,
      team: { netMinor: 13_000, lateNetMinor: 3_000 },
      now: day(5),
    });
    expect(pace).toEqual({
      lateNetMinor: null,
      forecastNetMinor: null,
      goal: { reachedBps: 1_300, forecastReachedBps: 3_300 },
    });
  });

  it('says nothing of a goal a member has no share of, nor without a window or a goal', () => {
    const base = {
      statements: [{ lines: [], team: team(null) }],
      figures: { netMinor: 0 },
      team: { netMinor: 0, lateNetMinor: 0 },
      now: day(5),
    };
    expect(periodPace({ ...base, window: WINDOW, goal, self: true }).goal).toEqual({
      reachedBps: null,
      forecastReachedBps: null,
    });
    expect(periodPace({ ...base, window: null, goal, self: false })).toEqual({
      lateNetMinor: 0,
      forecastNetMinor: null,
      goal: { reachedBps: 0, forecastReachedBps: null },
    });
    expect(periodPace({ ...base, window: WINDOW, goal: null, self: false }).goal).toBeNull();
  });
});
