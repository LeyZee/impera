import type { TrophyCase, TrophyCaseItem } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { earnedCount, foldedShelf, nextTrophy, onShelf, percentOf, SHELF_ORDER, shelvesOf } from './arrange';

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
    // An object of one gesture, still ahead: nothing to draw (CRE-14).
    expect(percentOf({ current: 0, target: 1, unit: 'once' }, false)).toBeNull();
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

describe('shelvesOf, an empty shelf', () => {
  it('is left out, unless the role keeps it to say why (CHT-17)', () => {
    const noMedals: TrophyCase = { ...CASE, items: CASE.items.filter((one) => one.family !== 'medal') };
    expect(shelvesOf(noMedals).map((shelf) => shelf.family)).toEqual(['streak', 'trophy']);
    expect(shelvesOf(noMedals, ['medal']).map((shelf) => shelf.family)).toEqual([
      'medal',
      'streak',
      'trophy',
    ]);
  });
});

describe('foldedShelf', () => {
  const shelf = (earned: number, waiting: number): Parameters<typeof foldedShelf>[0] => ({
    family: 'medal',
    earned,
    items: [
      ...Array.from({ length: earned }, (_, at) =>
        item({ kind: `won_${String(at)}`, family: 'medal', earnedAt: '2026-10-02T10:00:00.000Z' }),
      ),
      ...Array.from({ length: waiting }, (_, at) =>
        item({
          kind: `next_${String(at)}`,
          family: 'medal',
          progress: { current: 1, target: 9, unit: 'day' },
        }),
      ),
    ],
  });

  it('shows a short shelf whole, with nothing behind « Voir tout »', () => {
    const streaks = shelvesOf(CASE)[1];
    if (!streaks) throw new Error('no streak shelf');
    const { shown, hidden } = foldedShelf(streaks);
    expect(shown.map((one) => one.kind)).toEqual(['streak_5', 'streak_10', 'streak_25']);
    expect(hidden).toBe(0);
  });

  it('fills a full row of three for a newcomer, the rest behind « Voir tout » (CRE-14)', () => {
    const { shown, hidden } = foldedShelf(shelf(0, 8));
    expect(shown.map((one) => one.kind)).toEqual(['next_0', 'next_1', 'next_2']);
    expect(hidden).toBe(5);
  });

  it('shows every earned object and the next one, rounded up to full rows', () => {
    const { shown, hidden } = foldedShelf(shelf(4, 6));
    expect(shown).toHaveLength(6);
    expect(shown.slice(0, 4).every((one) => one.earnedAt !== null)).toBe(true);
    expect(hidden).toBe(4);
  });

  it('never hides a single row: up to three left over are shown at once', () => {
    expect(foldedShelf(shelf(1, 5)).hidden).toBe(0);
    expect(foldedShelf(shelf(0, 3)).hidden).toBe(0);
  });

  it('earned objects come first, whatever the order of the shelf', () => {
    const mixed = shelf(2, 5);
    const { shown } = foldedShelf({ ...mixed, items: [...mixed.items].reverse() });
    expect(shown.slice(0, 2).every((one) => one.earnedAt !== null)).toBe(true);
  });
});

it('counts what was earned', () => {
  expect(earnedCount(CASE)).toBe(3);
});

describe('onShelf', () => {
  it('lays medals, streaks and trophies on shelves, and leaves any other family to the role', () => {
    expect(SHELF_ORDER.every((family) => onShelf({ family }))).toBe(true);
  });
});

describe('nextTrophy, an object of one gesture (recette 16/11, CRE-14)', () => {
  it('puts a first gesture before a streak at nothing: on a tie, the least left to do', () => {
    const ahead = (kind: string, target: number, unit: 'day' | 'once'): TrophyCaseItem => ({
      kind,
      family: unit === 'once' ? 'trophy' : 'medal',
      earnedAt: null,
      revealedAt: null,
      progress: { current: 0, target, unit },
    });
    expect(
      nextTrophy({
        items: [ahead('day_streak_7', 7, 'day'), ahead('first_drop', 1, 'once')],
        streaks: [],
        level: null,
      })?.kind,
    ).toBe('first_drop');
  });

  it('keeps a streak under way before a first gesture', () => {
    const items: TrophyCaseItem[] = [
      {
        kind: 'first_drop',
        family: 'trophy',
        earnedAt: null,
        revealedAt: null,
        progress: { current: 0, target: 1, unit: 'once' },
      },
      {
        kind: 'day_streak_7',
        family: 'medal',
        earnedAt: null,
        revealedAt: null,
        progress: { current: 3, target: 7, unit: 'day' },
      },
    ];
    expect(nextTrophy({ items, streaks: [], level: null })?.kind).toBe('day_streak_7');
  });
});
