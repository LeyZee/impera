import { describe, expect, it } from 'vitest';

import { challengeMet, challengeTarget } from '../challenge';
import { levelOfRank, levelSteps, nextStep, ranksReached } from '../levels';
import { streakOf, type StreakReport } from '../streak';
import { beatsRecord, trophiesOf, type TrophyFacts } from '../trophies';

const shifts = (...reports: StreakReport[]) =>
  reports.map((report, index) => ({ endsAt: new Date(Date.UTC(2026, 10, 1 + index)), report }));

describe('streakOf (ADR 0104 § 13)', () => {
  it('counts the shifts in a row with a report on time', () => {
    expect(streakOf(shifts('on_time', 'on_time', 'on_time'))).toEqual({ current: 3, best: 3 });
  });

  it('is reset by a late or missing report, and keeps its best', () => {
    expect(streakOf(shifts('on_time', 'on_time', 'late', 'on_time'))).toEqual({ current: 1, best: 2 });
    expect(streakOf(shifts('on_time', 'missing'))).toEqual({ current: 0, best: 1 });
  });

  it('is neither fed nor broken by a shift excused or not due yet', () => {
    expect(streakOf(shifts('on_time', 'excused', 'on_time', 'pending'))).toEqual({ current: 2, best: 2 });
  });

  it('counts in the order the shifts end, whatever the order given', () => {
    const [first, second, third] = shifts('late', 'on_time', 'on_time');
    expect(streakOf([third, first, second].filter((shift) => shift !== undefined))).toEqual({
      current: 2,
      best: 2,
    });
  });

  it('is zero with no shift', () => {
    expect(streakOf([])).toEqual({ current: 0, best: 0 });
  });
});

describe('challengeTarget (ADR 0104 § 14)', () => {
  it('is the median of the comparable shifts', () => {
    expect(challengeTarget([10_000, 30_000, 20_000, 50_000, 40_000])).toBe(30_000);
    expect(challengeTarget([10_000, 20_000, 30_000, 40_000])).toBe(25_000);
  });

  it('does not exist under four comparable shifts, nor when they sold nothing', () => {
    expect(challengeTarget([10_000, 20_000, 30_000])).toBeNull();
    expect(challengeTarget([0, 0, 0, 0])).toBeNull();
  });

  it('is met at its target', () => {
    expect(challengeMet(25_000, 25_000)).toBe(true);
    expect(challengeMet(24_999, 25_000)).toBe(false);
  });
});

const NOTHING: TrophyFacts = {
  sales: 0,
  dayRecordBeaten: false,
  fortnightRecordBeaten: false,
  fortnightOnTime: false,
  bestStreak: 0,
  ppvBoughtInShift: null,
};

describe('trophiesOf (ADR 0104 § 15)', () => {
  it('gives nothing to a member with no fact yet', () => {
    expect(trophiesOf(NOTHING)).toEqual([]);
  });

  it('gives each trophy on its own fact', () => {
    expect(trophiesOf({ ...NOTHING, sales: 1 })).toEqual(['first_sale']);
    expect(trophiesOf({ ...NOTHING, dayRecordBeaten: true })).toEqual(['day_record']);
    expect(trophiesOf({ ...NOTHING, fortnightRecordBeaten: true })).toEqual(['fortnight_record']);
    expect(trophiesOf({ ...NOTHING, fortnightOnTime: true })).toEqual(['fortnight_on_time']);
  });

  it('gives the streak trophies at 5, 10 and 25 on the best streak', () => {
    expect(trophiesOf({ ...NOTHING, bestStreak: 4 })).toEqual([]);
    expect(trophiesOf({ ...NOTHING, bestStreak: 10 })).toEqual(['streak_5', 'streak_10']);
    expect(trophiesOf({ ...NOTHING, bestStreak: 25 })).toEqual(['streak_5', 'streak_10', 'streak_25']);
  });

  it('gives ten paid media in a shift only once they are counted', () => {
    expect(trophiesOf({ ...NOTHING, ppvBoughtInShift: null })).toEqual([]);
    expect(trophiesOf({ ...NOTHING, ppvBoughtInShift: 9 })).toEqual([]);
    expect(trophiesOf({ ...NOTHING, ppvBoughtInShift: 10 })).toEqual(['ten_ppv_shift']);
  });

  it('calls a record only what beats one before it', () => {
    expect(beatsRecord(10_000, [])).toBe(false);
    expect(beatsRecord(10_000, [10_000, 8_000])).toBe(false);
    expect(beatsRecord(10_001, [10_000, 8_000])).toBe(true);
  });
});

describe('the levels (ADR 0104 § 16)', () => {
  const steps = levelSteps([100_000, 500_000]);

  it('opens the ranks the owner gave a threshold to, by their names, the first first', () => {
    expect(steps).toEqual([
      { rank: 1, name: 'Recrue', thresholdMinor: 100_000 },
      { rank: 2, name: 'Légionnaire', thresholdMinor: 500_000 },
    ]);
    expect(levelSteps([])).toEqual([]);
    expect(levelSteps(Array.from({ length: 12 }, (_, index) => (index + 1) * 1_000))).toHaveLength(8);
  });

  it('reaches no rank without thresholds nor under the first, then every rank up to the net', () => {
    expect(ranksReached(1_000_000, [])).toEqual([]);
    expect(ranksReached(99_999, steps)).toEqual([]);
    expect(ranksReached(100_000, steps)).toEqual([1]);
    expect(ranksReached(900_000, steps)).toEqual([1, 2]);
  });

  it('names a rank by its number and finds the one ahead', () => {
    expect(levelOfRank(0)).toBeNull();
    expect(levelOfRank(8)).toEqual({ rank: 8, name: 'Imperator' });
    expect(levelOfRank(9)).toBeNull();
    expect(nextStep(0, steps)?.rank).toBe(1);
    expect(nextStep(1, steps)?.rank).toBe(2);
    expect(nextStep(2, steps)).toBeNull();
  });
});
