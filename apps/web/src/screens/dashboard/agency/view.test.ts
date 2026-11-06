import { describe, expect, it } from 'vitest';

import { AGENCY_WEEK } from './fixture';
import {
  arcs,
  bestSlot,
  busiest,
  byWeek,
  changeOf,
  dayStacks,
  deltaText,
  euros,
  kindSlices,
  OTHER,
  SERIES,
  sellerSlices,
  shortEuros,
  STACKS,
  zoneLabel,
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
    expect(deltaText(0)).toBe('0\u00a0%');
  });

  it('folds the rare kinds in « Autres ventes », each kind in its fixed colour', () => {
    const slices = kindSlices(AGENCY_WEEK.kinds);
    expect(slices.map((slice) => [slice.label, slice.cents, slice.colour])).toEqual([
      ['Abonnements', 42_000, SERIES[0]],
      ['PPV en privé', 112_600, SERIES[1]],
      ['Tips', 28_000, SERIES[3]],
      ['Autres ventes', 2_000, OTHER],
    ]);
  });

  it('groups who sold by family, the chatters together, in colours no kind of sale wears', () => {
    const slices = sellerSlices(AGENCY_WEEK.sellers);
    expect(slices.map((slice) => [slice.label, slice.cents])).toEqual([
      ['Chatteurs', 98_000],
      ['Agent IA', 44_600],
      ['Sans chatteur', 42_000],
    ]);
    expect(slices.find((slice) => slice.key === 'agent')?.colour).toBe('var(--nv-agent)');
    const kinds = new Set<string>(SERIES);
    expect(slices.filter((slice) => kinds.has(slice.colour))).toEqual([]);
  });

  it('cuts a day by kind, in the ring’s order and colours', () => {
    const day = AGENCY_WEEK.days[0];
    if (day === undefined) throw new Error('fixture');
    expect(dayStacks(day)).toEqual([6_000, 10_000, 0, 4_000, 0]);
    expect(STACKS.map((stack) => stack.colour)).toEqual([...SERIES, OTHER]);
  });

  it('reads three months a week a column on a phone, the last week shorter', () => {
    const days = Array.from({ length: 9 }, (_, i) => ({
      key: `d${String(i)}`,
      label: String(i),
      title: `jour ${String(i)}`,
      parts: [100, 1],
      total: 101,
    }));
    expect(byWeek(days)).toEqual([
      { key: 'd0', label: '0', title: 'Semaine du jour 0', parts: [700, 7], total: 707 },
      { key: 'd7', label: '7', title: 'Semaine du jour 7', parts: [200, 2], total: 202 },
    ]);
  });

  it('names the hours’ zone by its city', () => {
    expect(zoneLabel('Europe/Paris')).toBe('heure de Paris');
    expect(zoneLabel('America/New_York')).toBe('heure de New York');
  });

  it('finds when it sells: the busiest cell and the best slot of three hours', () => {
    expect(busiest(AGENCY_WEEK.hours)).toEqual({ day: 6, hour: 0, cents: 2_700 });
    expect(bestSlot(AGENCY_WEEK.hours)?.from).toBe(21);
    expect(busiest(Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)))).toBeNull();
  });

  it('draws a ring whose arcs follow each other', () => {
    const [first, second] = arcs([1, 3], 10, 0);
    expect(first?.offset).toBe(0);
    expect(second?.offset).toBeCloseTo(-15.71, 1);
  });
});
