import { describe, expect, it } from 'vitest';

import {
  againstText,
  compareChoices,
  comparable,
  mondayOf,
  monthStart,
  neighbours,
  periodChoices,
  readName,
  selectionQuery,
  spanText,
  withCompare,
} from './period';

const TODAY = '2026-11-16';
const span = (unit: 'day' | 'week' | 'month' | 'custom', partial = false) =>
  ({ unit, partial, end: TODAY, compare: 'previous', today: TODAY }) as const;

describe('the agency’s days (ADR 0146)', () => {
  it('finds a week’s Monday and a month’s first day, across years', () => {
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(monthStart('2026-01-20', -1)).toBe('2025-12-01');
    expect(monthStart('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('writes days as short as they read, the year only when it is not this one', () => {
    expect(spanText('2026-10-01', '2026-10-16', TODAY)).toBe('1er–16 oct.');
    expect(spanText('2026-11-16', '2026-11-16', TODAY)).toBe('16 nov.');
    expect(spanText('2026-09-28', '2026-10-04', TODAY)).toBe('28 sept. – 4 oct.');
    expect(spanText('2025-12-29', '2026-01-04', TODAY)).toBe('29 déc. 2025 – 4 janv. 2026');
    expect(spanText('2025-11-01', '2025-11-16', TODAY)).toBe('1er–16 nov. 2025');
  });

  it('names the period read and always says the days it is compared with', () => {
    const month = { span: span('month', true), from: '2026-11-01', to: TODAY };
    expect(readName(month)).toBe('Novembre 2026');
    expect(againstText({ ...month, previousFrom: '2026-10-01', previousTo: '2026-10-16' })).toBe(
      'comparé aux 1er–16 oct.',
    );
    expect(readName({ span: span('day'), from: TODAY, to: TODAY })).toBe('Aujourd’hui');
    expect(readName({ span: span('week'), from: '2026-11-09', to: '2026-11-15' })).toBe('9–15 nov.');
  });

  it('moves back and forth, never to a period to come', () => {
    const insights = { span: span('month', true), from: '2026-11-01' };
    expect(neighbours({ unit: 'month' }, insights)).toEqual({
      previous: { unit: 'month', at: '2026-10-01' },
      next: null,
    });
    expect(
      neighbours({ unit: 'month', at: '2026-10-01' }, { span: span('month'), from: '2026-10-01' }),
    ).toEqual({
      previous: { unit: 'month', at: '2026-09-01' },
      next: { unit: 'month', at: '2026-11-01' },
    });
    expect(
      neighbours(
        { unit: 'custom', from: '2026-11-01', to: '2026-11-10' },
        { span: span('custom'), from: '2026-11-01' },
      ),
    ).toEqual({
      previous: { unit: 'custom', from: '2026-10-22', to: '2026-10-31' },
      next: { unit: 'custom', from: '2026-11-11', to: '2026-11-20' },
    });
  });

  it('lists the periods back from the running one', () => {
    expect(periodChoices('month', TODAY, 3).map((one) => one.label)).toEqual([
      'Novembre 2026',
      'Octobre 2026',
      'Septembre 2026',
    ]);
    expect(periodChoices('week', TODAY, 2).map((one) => one.value)).toEqual(['2026-11-16', '2026-11-09']);
  });

  it('offers the period just before, then earlier ones of the same unit, a Saturday against a Saturday', () => {
    const months = compareChoices({ unit: 'month' }, '2026-11-01', TODAY);
    expect(months[0]).toEqual({ value: 'previous', label: 'vs mois précédent' });
    expect(months[1]).toEqual({ value: '2026-09-01', label: 'vs Septembre 2026' });
    expect(months.some((one) => one.value === '2025-11-01')).toBe(true);
    const days = compareChoices({ unit: 'day' }, '2026-11-14', TODAY);
    expect(days.slice(0, 2).map((one) => one.label)).toEqual([
      'vs veille',
      'vs même jour, semaine précédente',
    ]);
    expect(
      compareChoices({ unit: 'custom', from: '2026-11-01', to: '2026-11-10' }, '2026-11-01', TODAY),
    ).toHaveLength(2);
    expect(withCompare({ unit: 'month', compareAt: '2025-11-01' }, 'previous')).toEqual({ unit: 'month' });
    expect(withCompare({ unit: 'month' }, '2025-11-01')).toEqual({ unit: 'month', compareAt: '2025-11-01' });
  });

  it('compares nothing the register does not reach back to (§ 4)', () => {
    expect(comparable({ registerSince: '2026-10-20', previousFrom: '2026-10-01' })).toBe(false);
    expect(comparable({ registerSince: '2026-10-01', previousFrom: '2026-10-01' })).toBe(true);
    expect(comparable({ registerSince: null, previousFrom: '2026-10-01' })).toBe(true);
  });

  it('asks the server in its words', () => {
    expect(selectionQuery({ unit: 'month' })).toEqual({ unit: 'month' });
    expect(
      selectionQuery({ unit: 'custom', from: '2026-10-01', to: '2026-10-19', compareAt: '2026-09-01' }),
    ).toEqual({
      unit: 'custom',
      from: '2026-10-01',
      to: '2026-10-19',
      compareAt: '2026-09-01',
    });
  });
});
