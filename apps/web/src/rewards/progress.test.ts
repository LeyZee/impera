import type { TrophyCase, TrophyCaseItem } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { nextGoals } from './progress';

const ahead = (
  kind: string,
  current: number,
  target: number,
  unit: 'shift' | 'cents' | 'once',
): TrophyCaseItem => ({
  kind,
  family: 'trophy',
  earnedAt: null,
  progress: { current, target, unit },
  revealedAt: null,
});

const CASE: TrophyCase = {
  items: [
    ahead('streak_10', 4, 10, 'shift'),
    ahead('streak_5', 4, 5, 'shift'),
    ahead('day_record', 9_000, 10_000, 'cents'),
    ahead('first_sale', 0, 1, 'once'),
    ahead('streak_25', 4, 25, 'shift'),
    { ...ahead('fortnight_on_time', 1, 1, 'shift'), earnedAt: '2026-11-10T10:00:00Z' },
    { ...ahead('ten_ppv_shift', 0, 10, 'shift'), progress: null },
    ahead('tier:2026-11-01:100000', 50, 100, 'cents'),
  ],
  streaks: [],
  level: null,
};

describe('nextGoals', () => {
  it('keeps the goals ahead that have a count, the nearest first, three at most', () => {
    expect(nextGoals(CASE).map((goal) => goal.kind)).toEqual(['day_record', 'streak_5', 'streak_10']);
  });

  it('says what is left in the goal’s unit, an amount as a share, and when it is near', () => {
    const [record, five, ten] = nextGoals(CASE);
    expect(record).toMatchObject({ left: '90 %', near: true, steps: null });
    expect(five).toMatchObject({ left: 'Encore 1 shift', near: true, steps: 5, percent: 80 });
    expect(ten).toMatchObject({ left: 'Encore 6 shifts', near: false, steps: 10 });
  });

  it('never draws full a goal the server has not noted yet', () => {
    const [goal] = nextGoals({ ...CASE, items: [ahead('streak_5', 5, 5, 'shift')] });
    expect(goal).toMatchObject({ percent: 99, left: 'Encore 1 shift' });
  });

  it('takes more when asked', () => {
    expect(nextGoals(CASE, 4).map((goal) => goal.kind)).toContain('streak_25');
  });
});
