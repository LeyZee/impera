import { describe, expect, it } from 'vitest';

import {
  calendarDayAt,
  collectiveGoalLastDay,
  collectiveGoalWindow,
  nextPayPeriod,
  payPeriodAt,
  PayPeriodSchema,
  payPeriodLastDay,
  payPeriodNotBegun,
  payPeriodOfDay,
  previousPayPeriod,
} from './pay-periods';

const period = (day: string) => PayPeriodSchema.parse(day);

describe('pay periods (ADR 0023)', () => {
  it('names a fortnight by its first day, the 1st or the 16th', () => {
    expect(PayPeriodSchema.safeParse('2026-10-01').success).toBe(true);
    expect(PayPeriodSchema.safeParse('2026-10-16').success).toBe(true);
    for (const day of ['2026-10-02', '2026-10-15', '2026-13-01', '2026-02-30', 'octobre']) {
      expect(PayPeriodSchema.safeParse(day).success).toBe(false);
    }
  });

  it('puts the 15th in the first fortnight and the 16th in the second', () => {
    expect(payPeriodOfDay('2026-10-01')).toBe('2026-10-01');
    expect(payPeriodOfDay('2026-10-15')).toBe('2026-10-01');
    expect(payPeriodOfDay('2026-10-16')).toBe('2026-10-16');
    expect(payPeriodOfDay('2026-10-31')).toBe('2026-10-16');
  });

  it('throws on anything but a day that exists', () => {
    for (const day of ['2026-10-40', '2026-02-30', '28/10/2026', '']) {
      expect(() => payPeriodOfDay(day)).toThrow();
    }
  });

  it('ends a second fortnight on the last day of its month', () => {
    expect(payPeriodLastDay(period('2026-10-01'))).toBe('2026-10-15');
    expect(payPeriodLastDay(period('2026-10-16'))).toBe('2026-10-31');
    expect(payPeriodLastDay(period('2026-11-16'))).toBe('2026-11-30');
    expect(payPeriodLastDay(period('2026-02-16'))).toBe('2026-02-28');
    expect(payPeriodLastDay(period('2028-02-16'))).toBe('2028-02-29');
  });

  it('steps from one period to the next and back, across the year', () => {
    expect(nextPayPeriod(period('2026-10-01'))).toBe('2026-10-16');
    expect(nextPayPeriod(period('2026-10-16'))).toBe('2026-11-01');
    expect(nextPayPeriod(period('2026-12-16'))).toBe('2027-01-01');
    expect(previousPayPeriod(period('2027-01-01'))).toBe('2026-12-16');
    expect(previousPayPeriod(period('2026-11-01'))).toBe('2026-10-16');
    expect(previousPayPeriod(period('2026-10-16'))).toBe('2026-10-01');
  });

  it('sorts like the periods', () => {
    const periods = ['2026-10-16', '2025-12-16', '2026-01-01', '2026-10-01'].map(period);
    expect([...periods].sort()).toEqual(['2025-12-16', '2026-01-01', '2026-10-01', '2026-10-16']);
  });

  it('reads the period of an instant in the agency’s zone, not in UTC', () => {
    // 15 March, 23:30 in UTC is 16 March, 00:30 in Paris: the second fortnight there.
    expect(payPeriodAt(new Date('2026-03-15T23:30:00Z'), 'Europe/Paris')).toBe('2026-03-16');
    expect(payPeriodAt(new Date('2026-03-15T23:30:00Z'), 'UTC')).toBe('2026-03-01');
    expect(payPeriodAt(new Date('2026-12-31T23:30:00Z'), 'Europe/Paris')).toBe('2027-01-01');
  });

  it('reads today in the agency’s zone, not in UTC', () => {
    expect(calendarDayAt(new Date('2026-10-31T23:30:00Z'), 'Europe/Paris')).toBe('2026-11-01');
    expect(calendarDayAt(new Date('2026-10-31T23:30:00Z'), 'UTC')).toBe('2026-10-31');
  });
});

describe('when a pay rule of the team may start (PAIE-22)', () => {
  it('calls a period not begun until its first day, as a rate', () => {
    expect(payPeriodNotBegun(period('2026-11-01'), '2026-10-31')).toBe(true);
    expect(payPeriodNotBegun(period('2026-11-01'), '2026-11-01')).toBe(true);
    expect(payPeriodNotBegun(period('2026-11-01'), '2026-11-02')).toBe(false);
  });

  it('keeps a goal open to its 3rd day, with the period begun from its first', () => {
    expect(collectiveGoalLastDay(period('2026-11-01'))).toBe('2026-11-03');
    expect(collectiveGoalLastDay(period('2026-11-16'))).toBe('2026-11-18');
    expect(collectiveGoalWindow(period('2026-11-16'), '2026-11-15')).toBe('ahead');
    expect(collectiveGoalWindow(period('2026-11-16'), '2026-11-16')).toBe('started');
    expect(collectiveGoalWindow(period('2026-11-16'), '2026-11-18')).toBe('started');
    expect(collectiveGoalWindow(period('2026-11-16'), '2026-11-19')).toBe('closed');
    expect(collectiveGoalWindow(period('2026-12-16'), '2027-01-02')).toBe('closed');
  });
});
