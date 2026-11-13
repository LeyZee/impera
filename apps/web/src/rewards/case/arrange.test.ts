import type { TrophyCase, TrophyCaseItem } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { earnedCount, foldedShelf, nextTrophy, percentOf, shelvesOf } from './arrange';

const item = (over: Partial<TrophyCaseItem> & Pick<TrophyCaseItem, 'kind' | 'family'>): TrophyCaseItem => ({
  earnedAt: null,
  progress: null,
  revealedAt: null,
  ...over,
});

const CASE: TrophyCase = {
  items: [
    item({
      kind: 'first_sale',
      family: 'trophy',
      earnedAt: '2026-10-02T10:00:00.000Z',
      revealedAt: '2026-10-02T10:00:00.000Z',
    }),
    item({ kind: 'streak_25', family: 'streak', progress: { current: 9, target: 25, unit: 'shift' } }),
    item({ kind: 'tier_3', family: 'medal', progress: { current: 38, target: 100, unit: 'cents' } }),
    item({ kind: 'streak_10', family: 'streak', progress: { current: 9, target: 10, unit: 'shift' } }),
    item({ kind: 'day_record', family: 'trophy', earnedAt: '2026-11-04T10:00:00.000Z', revealedAt: null }),
    item({
      kind: 'streak_5',
      family: 'streak',
      earnedAt: '2026-10-28T10:00:00.000Z',
      revealedAt: '2026-10-28T10:00:00.000Z',
    }),
    item({ kind: 'fortnight_record', family: 'trophy' }),
  ],
  streaks: [{ kind: 'shift', current: 9, best: 14 }],
  level: null,
};

describe('percentOf', () => {
  it('rounds down and never reaches 100 % before the object is earned', () => {
    expect(percentOf({ current: 9, target: 10, unit: 'shift' }, false)).toBe(90);
    expect(percentOf({ current: 2, target: 3, unit: 'category' }, false)).toBe(66);
    expect(percentOf({ current: 10, target: 10, unit: 'shift' }, false)).toBe(99);
    expect(percentOf({ current: 0, target: 7, unit: 'day' }, false)).toBe(0);
  });

  it('says nothing for an object without a count, and 100 % once earned', () => {
    expect(percentOf(null, false)).toBeNull();
    expect(percentOf(null, true)).toBe(100);
  });
});

describe('shelvesOf', () => {
  it('keeps the shelves in their fixed order, earned first, then the most advanced', () => {
    const shelves = shelvesOf(CASE);
    expect(shelves.map((shelf) => shelf.family)).toEqual(['medal', 'streak', 'trophy']);
    expect(shelves[1]?.items.map((one) => one.kind)).toEqual(['streak_5', 'streak_10', 'streak_25']);
    expect(shelves[2]?.items.map((one) => one.kind)).toEqual([
      'day_record',
      'first_sale',
      'fortnight_record',
    ]);
    expect(shelves.map((shelf) => shelf.earned)).toEqual([0, 1, 2]);
  });

  it('leaves out an empty shelf', () => {
    expect(
      shelvesOf({ ...CASE, items: CASE.items.filter((one) => one.family !== 'medal') }).map((s) => s.family),
    ).toEqual(['streak', 'trophy']);
  });
});

describe('nextTrophy', () => {
  it('is the most advanced object ahead that has a count', () => {
    expect(nextTrophy(CASE)?.kind).toBe('streak_10');
  });

  it('breaks a tie on what is left to do', () => {
    const tie: TrophyCase = {
      ...CASE,
      items: [
        item({ kind: 'a', family: 'streak', progress: { current: 5, target: 10, unit: 'shift' } }),
        item({ kind: 'b', family: 'medal', progress: { current: 1, target: 2, unit: 'day' } }),
      ],
    };
    expect(nextTrophy(tie)?.kind).toBe('b');
  });

  it('is nothing when every object ahead is earned at once', () => {
    expect(nextTrophy({ ...CASE, items: [item({ kind: 'fortnight_record', family: 'trophy' })] })).toBeNull();
  });
});

describe('foldedShelf', () => {
  it('shows the earned objects and the next one, and counts the rest', () => {
    const streaks = shelvesOf(CASE)[1];
    if (!streaks) throw new Error('no streak shelf');
    const { shown, hidden } = foldedShelf(streaks);
    expect(shown.map((one) => one.kind)).toEqual(['streak_5', 'streak_10']);
    expect(hidden).toBe(1);
  });
});

it('counts what was earned', () => {
  expect(earnedCount(CASE)).toBe(3);
});
