import { CreatorIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { AGENCY_WEEK, LINA, MAYA } from './fixture';
import {
  arcs,
  bestSlot,
  busiest,
  changeOf,
  creatorColours,
  dayStacks,
  deltaText,
  euros,
  kindSlices,
  OTHER,
  SERIES,
  sellerSlices,
  shortEuros,
  stackSeries,
  weekdayIndex,
} from './view';

describe('the agency’s figures as the screen says them (ADR 0078)', () => {
  it('writes euros from cents, the cents only when there are some', () => {
    expect(euros(184_600)).toBe('1 846 €');
    expect(euros(1_050)).toBe('10,50 €');
    expect(shortEuros(184_600)).toBe('1,8 k€');
    expect(shortEuros(4_000)).toBe('40 €');
  });

  it('compares with the period before, nothing when there was nothing before', () => {
    expect(changeOf(184_600, 156_000)).toBe(18);
    expect(changeOf(100, 0)).toBeNull();
    expect(deltaText(18)).toBe('+18 %');
    expect(deltaText(-4)).toBe('−4 %');
    expect(deltaText(0)).toBe('=');
  });

  it('folds the rare kinds in « Autres ventes », each kind in its fixed colour', () => {
    const slices = kindSlices(AGENCY_WEEK.kinds);
    expect(slices.map((slice) => [slice.label, slice.cents, slice.colour])).toEqual([
      ['Abonnements', 42_000, SERIES[0]],
      ['PPV en privé', 112_600, SERIES[1]],
      ['Tips', 28_000, SERIES[3]],
      ['Autres ventes', 2_000, SERIES[4]],
    ]);
  });

  it('groups who sold by family, the chatters together', () => {
    expect(sellerSlices(AGENCY_WEEK.sellers).map((slice) => [slice.label, slice.cents])).toEqual([
      ['Chatteurs', 98_000],
      ['Agent IA', 44_600],
      ['Sans chatteur', 42_000],
    ]);
  });

  it('keeps a creator’s colour whatever her rank, the sixth in « Autres »', () => {
    expect(creatorColours(AGENCY_WEEK.creators).get(MAYA)).toBe(SERIES[1]);
    const many = Array.from({ length: 7 }, (_, i) => ({
      creatorId: CreatorIdSchema.parse(`00000000-0000-4000-8000-00000000c00${String(i)}`),
      name: `C${String(i)}`,
    }));
    const stacks = stackSeries({ ...AGENCY_WEEK, creators: many }, false);
    expect(stacks).toHaveLength(6);
    expect(stacks[5]).toEqual({ key: 'other', label: 'Autres créatrices', colour: OTHER });
  });

  it('cuts a day by creator for the agency, by kind for one creator', () => {
    const day = AGENCY_WEEK.days[0];
    if (day === undefined) throw new Error('fixture');
    expect(dayStacks(day, stackSeries(AGENCY_WEEK, false), false)).toEqual([12_000, 8_000]);
    expect(dayStacks(day, stackSeries(AGENCY_WEEK, true), true)).toEqual([6_000, 10_000, 0, 4_000, 0]);
    expect(LINA).not.toBe(MAYA);
  });

  it('finds when it sells: the busiest cell and the best slot of three hours', () => {
    expect(busiest(AGENCY_WEEK.hours)).toEqual({ day: 6, hour: 0, cents: 2_700 });
    expect(bestSlot(AGENCY_WEEK.hours)?.from).toBe(21);
    expect(busiest(Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)))).toBeNull();
    expect(weekdayIndex('2026-11-02')).toBe(0); // a Monday
  });

  it('draws a ring whose arcs follow each other', () => {
    const [first, second] = arcs([1, 3], 10, 0);
    expect(first?.offset).toBe(0);
    expect(second?.offset).toBeCloseTo(-15.71, 1);
  });
});
