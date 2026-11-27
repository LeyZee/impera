import { PlatformScriptIdSchema, newId } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  rankPerformances,
  readingKey,
  revealOver,
  scriptPerformanceOf,
  type DailyReading,
  type MeasuredScript,
  type PeriodRun,
} from '../performance';

const period = { from: '2026-11-01', to: '2026-11-30' };
const reading = (day: string, sent: number, purchased: number, paidMinor: number): DailyReading => ({
  day,
  sent,
  purchased,
  paidMinor,
});

const script: MeasuredScript = {
  id: newId(PlatformScriptIdSchema),
  ref: 'script_1',
  name: 'Soirée',
  moment: 'night',
  currency: 'EUR',
  steps: [
    { rank: 0, refs: [readingKey('acc', 's0')], paid: false },
    { rank: 1, refs: [readingKey('acc', 's1a'), readingKey('acc', 's1b')], paid: true },
  ],
};

/** A run that got the free step, then the paid one, bought or not. */
const run = (bought: boolean | null): PeriodRun => ({
  scriptRef: 'script_1',
  steps: [
    { stepIndex: 0, outcome: 'opened', priceMinor: null },
    ...(bought === null
      ? []
      : [{ stepIndex: 1, outcome: bought ? ('bought' as const) : ('refused' as const), priceMinor: 1500 }]),
  ],
});

describe('revealOver', () => {
  it('counts the period as its last reading less the last one before it', () => {
    expect(
      revealOver(
        [
          reading('2026-10-20', 10, 2, 1000),
          reading('2026-11-10', 14, 3, 1500),
          reading('2026-11-20', 20, 5, 2500),
        ],
        period,
      ),
    ).toEqual({ totals: { sent: 10, purchased: 3, paidMinor: 1500 }, since: '2026-11-01' });
  });

  it('starts from the first reading of the period when none came before, and says so', () => {
    expect(revealOver([reading('2026-11-05', 4, 1, 500), reading('2026-11-09', 9, 2, 900)], period)).toEqual({
      totals: { sent: 5, purchased: 1, paidMinor: 400 },
      since: '2026-11-05',
    });
  });

  it('has nothing to say without a reading in the period, and never counts below zero', () => {
    expect(revealOver([reading('2026-10-02', 4, 1, 500)], period)).toBeNull();
    expect(revealOver([reading('2026-10-02', 9, 3, 900), reading('2026-11-02', 2, 0, 0)], period)).toEqual({
      totals: { sent: 0, purchased: 0, paidMinor: 0 },
      since: '2026-11-01',
    });
  });
});

describe('scriptPerformanceOf', () => {
  it('counts fans, purchases and money from the runs, and Reveal’s branches together by rank', () => {
    const runs = [
      ...Array.from({ length: 15 }, () => run(true)),
      ...Array.from({ length: 10 }, () => run(false)),
      run(null),
    ];
    const readings = new Map([
      [readingKey('acc', 's0'), [reading('2026-11-02', 40, 0, 0)]],
      [readingKey('acc', 's1a'), [reading('2026-10-30', 5, 1, 1500), reading('2026-11-29', 25, 9, 13_500)]],
      [readingKey('acc', 's1b'), [reading('2026-11-03', 0, 0, 0), reading('2026-11-29', 4, 1, 1500)]],
    ]);
    const line = scriptPerformanceOf(script, runs, readings, period, 20);
    expect(line).toMatchObject({
      fans: 26,
      revenueMinor: 22_500,
      revenuePerFanMinor: 865,
      revealSince: '2026-11-03',
    });
    expect(line.steps).toEqual([
      {
        rank: 0,
        paid: false,
        sent: 26,
        bought: 0,
        purchaseRate: null,
        reveal: { sent: 0, purchased: 0, paidMinor: 0 },
      },
      {
        rank: 1,
        paid: true,
        sent: 25,
        bought: 15,
        purchaseRate: 0.6,
        reveal: { sent: 24, purchased: 9, paidMinor: 13_500 },
      },
    ]);
  });

  it('holds every rate back under the minimum of fans, and Reveal’s count while a branch has no reading', () => {
    const line = scriptPerformanceOf(script, [run(true), run(false)], new Map(), period, 20);
    expect(line).toMatchObject({ fans: 2, revenueMinor: 1500, revenuePerFanMinor: null, revealSince: null });
    expect(line.steps[1]).toMatchObject({ sent: 2, bought: 1, purchaseRate: null, reveal: null });
  });

  it('counts a step once per run, even when the run kept it twice', () => {
    const twice: PeriodRun = {
      scriptRef: 'script_1',
      steps: [
        { stepIndex: 1, outcome: 'refused', priceMinor: 1500 },
        { stepIndex: 1, outcome: 'bought', priceMinor: 1500 },
      ],
    };
    expect(scriptPerformanceOf(script, [twice], new Map(), period, 20).steps[1]).toMatchObject({
      sent: 1,
      bought: 0,
    });
  });
});

describe('rankPerformances', () => {
  it('puts the most revenue per fan first and the scripts under the minimum last', () => {
    const base = scriptPerformanceOf(script, [], new Map(), period, 20);
    const lines = [
      { ...base, name: 'Peu', fans: 3, revenuePerFanMinor: null },
      { ...base, name: 'Moyen', fans: 40, revenuePerFanMinor: 300 },
      { ...base, name: 'Fort', fans: 25, revenuePerFanMinor: 900 },
      { ...base, name: 'Rien', fans: 0, revenuePerFanMinor: null },
    ];
    expect(rankPerformances(lines).map((line) => line.name)).toEqual(['Fort', 'Moyen', 'Peu', 'Rien']);
  });
});
