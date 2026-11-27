import { WeekPlanSchema, type WeekPlanItem } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  addShootDay,
  freeDays,
  loadOf,
  moveDay,
  moveLine,
  overloaded,
  removeShootDay,
  restoreLine,
} from './model';

/* An invented week: Monday 23 November, shooting on Wednesday and Saturday. */
const MONDAY = '2026-11-23';
const item = (label: string, minutes: number): WeekPlanItem => ({
  need: 'feed_shoot',
  label,
  sheet: null,
  minutes,
  count: 1,
  requestId: null,
});
const plan = WeekPlanSchema.parse({
  shootDays: [
    { day: '2026-11-25', items: [item('Séance A', 45), item('Séance B', 45)] },
    { day: '2026-11-28', items: [item('Vidéo A', 30)] },
  ],
  deferred: [item('Séance C', 45)],
  dueAt: '2026-11-29T22:00:00.000Z',
  stock: { sessions: 1, videos: 0, stories: 2 },
  capacityMinutes: 60,
});

const [wednesday, saturday] = plan.shootDays;
if (wednesday === undefined || saturday === undefined) throw new Error('two days expected');

describe('the owner’s corrections of a week', () => {
  it('counts a day’s load and flags it over capacity', () => {
    expect(loadOf(wednesday)).toBe(90);
    expect(overloaded(wednesday, plan)).toBe(true);
    expect(overloaded(saturday, plan)).toBe(false);
  });

  it('lists the free days, the moved one keeping its own', () => {
    expect(freeDays(plan, MONDAY)).toHaveLength(5);
    expect(freeDays(plan, MONDAY, '2026-11-25')).toContain('2026-11-25');
  });

  it('moves a day with its lines, kept in order, never onto another shooting day', () => {
    const moved = moveDay(plan, '2026-11-28', '2026-11-24');
    expect(moved.shootDays.map((day) => day.day)).toEqual(['2026-11-24', '2026-11-25']);
    expect(moved.shootDays[0]?.items[0]?.label).toBe('Vidéo A');
    expect(moveDay(plan, '2026-11-28', '2026-11-25')).toBe(plan);
  });

  it('moves a line to another day, or to the week after, and puts it back on the roomiest day', () => {
    const moved = moveLine(plan, '2026-11-25', 1, { day: '2026-11-28' });
    expect(moved.shootDays.map((day) => day.items.length)).toEqual([1, 2]);
    const put = moveLine(plan, '2026-11-25', 0, 'deferred');
    expect(put.deferred.map((one) => one.label)).toEqual(['Séance A', 'Séance C']);
    const back = restoreLine(put, 1);
    expect(back.deferred).toHaveLength(1);
    expect(back.shootDays[1]?.items.map((one) => one.label)).toEqual(['Vidéo A', 'Séance C']);
    expect(WeekPlanSchema.safeParse(back).success).toBe(true);
  });

  it('adds a day from Wednesday on, at most three, and takes one off to the week after but never the last', () => {
    const three = addShootDay(plan, MONDAY);
    expect(three.shootDays.map((day) => day.day)).toEqual(['2026-11-25', '2026-11-26', '2026-11-28']);
    expect(addShootDay(three, MONDAY)).toBe(three);
    const one = removeShootDay(plan, '2026-11-25');
    expect(one.shootDays).toHaveLength(1);
    expect(one.deferred.map((line) => line.label)).toEqual(['Séance A', 'Séance B', 'Séance C']);
    expect(removeShootDay(one, '2026-11-28')).toBe(one);
  });
});
