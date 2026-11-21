import { describe, expect, it } from 'vitest';

import {
  againstText,
  canConclude,
  conclusionWait,
  CONCLUDE_MIN_REGISTER_DAYS,
  CONCLUDE_MIN_SALES,
  isDay,
  compareChoices,
  comparable,
  mondayOf,
  monthStart,
  neighbours,
  periodChoices,
  readName,
  registerDays,
  selectionQuery,
  spanText,
  TOO_FEW_TO_CONCLUDE,
  TOO_YOUNG_TO_CONCLUDE,
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
    expect(months[0]).toEqual({ value: 'previous', label: 'comparé au mois précédent' });
    expect(months[1]).toEqual({ value: '2026-09-01', label: 'vs septembre 2026' });
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

  it('takes only real calendar days from an address typed by hand', () => {
    expect(isDay('2026-02-28')).toBe(true);
    expect(isDay('2026-02-31')).toBe(false);
    expect(isDay('2026-13-01')).toBe(false);
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

describe('no conclusion on too few sales (ADR 0092 § 5)', () => {
  const figures = (sales: number) => ({
    revenueMinor: 0,
    revenueExclVatMinor: 0,
    netMinor: 0,
    agencyMinor: 0,
    creatorMinor: 0,
    agencyTransferVatMinor: 0,
    sales,
    refunds: 0,
  });
  const read = (input: { from: string; to: string; registerSince: string | null; sales: number }) => ({
    from: input.from,
    to: input.to,
    registerSince: input.registerSince,
    span: span('custom'),
    totals: { current: figures(input.sales), previous: figures(0) },
  });

  it('counts the days of the period the registers covered, up to today', () => {
    expect(
      registerDays(read({ from: '2026-11-10', to: '2026-11-16', registerSince: '2026-09-01', sales: 0 })),
    ).toBe(7);
    expect(
      registerDays(read({ from: '2026-11-10', to: '2026-11-16', registerSince: '2026-11-14', sales: 0 })),
    ).toBe(3);
    // A month asked past today counts the days up to today only.
    expect(
      registerDays(read({ from: '2026-11-01', to: '2026-11-30', registerSince: '2026-09-01', sales: 0 })),
    ).toBe(16);
    expect(registerDays(read({ from: '2026-11-10', to: '2026-11-16', registerSince: null, sales: 0 }))).toBe(
      0,
    );
    expect(
      registerDays(read({ from: '2026-11-10', to: '2026-11-12', registerSince: '2026-11-15', sales: 0 })),
    ).toBe(0);
  });

  it('concludes only with enough sales and enough days of register, both', () => {
    const week = { from: '2026-11-10', to: '2026-11-16', registerSince: '2026-09-01' };
    expect(canConclude(read({ ...week, sales: CONCLUDE_MIN_SALES }))).toBe(true);
    expect(canConclude(read({ ...week, sales: CONCLUDE_MIN_SALES - 1 }))).toBe(false);
    const young = { ...week, registerSince: '2026-11-11', sales: CONCLUDE_MIN_SALES * 10 };
    expect(registerDays(read(young))).toBe(CONCLUDE_MIN_REGISTER_DAYS - 1);
    expect(canConclude(read(young))).toBe(false);
    // A single day never holds enough days of register, however many sales.
    expect(canConclude(read({ ...week, from: TODAY, sales: CONCLUDE_MIN_SALES * 10 }))).toBe(false);
  });

  it('says why: too little hindsight first, then too few sales', () => {
    const week = { from: '2026-11-10', to: '2026-11-16', registerSince: '2026-09-01' };
    expect(conclusionWait(read({ ...week, sales: CONCLUDE_MIN_SALES }))).toBeNull();
    expect(conclusionWait(read({ ...week, sales: 1 }))).toBe(TOO_FEW_TO_CONCLUDE);
    expect(conclusionWait(read({ ...week, registerSince: '2026-11-15', sales: 1 }))).toBe(
      TOO_YOUNG_TO_CONCLUDE,
    );
  });
});
