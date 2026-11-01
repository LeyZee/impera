import { DomainError, PayPeriodSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  assertFreshRates,
  ecbDay,
  eurosPerUnitMicros,
  isRateOverdue,
  weekdaysWithoutRate,
} from '../exchange-rates';

import { USD } from './fixtures';

describe('the ECB’s rate in pay’s terms (ADR 0033)', () => {
  it('turns dollars for one euro into euros for one dollar, in millionths, on integers', () => {
    // Rates the ECB published, as it writes them.
    expect(eurosPerUnitMicros('1.1188')).toBe(893_815);
    expect(eurosPerUnitMicros('1.0850')).toBe(921_659);
    expect(eurosPerUnitMicros('1.1')).toBe(909_091);
    expect(eurosPerUnitMicros('1')).toBe(1_000_000);
    expect(eurosPerUnitMicros('0.5')).toBe(2_000_000);
    // 39 062.5 exactly: half away from zero, as every rounding of pay.
    expect(eurosPerUnitMicros('25.6')).toBe(39_063);
    expect(eurosPerUnitMicros('162.84')).toBe(6_141);
  });

  it('refuses a rate that is not a positive decimal written with a point', () => {
    for (const written of [
      '1,1188',
      '',
      ' 1.1',
      '1.',
      '.5',
      '-1.1',
      '0',
      '0.0000',
      '1.123456789',
      '1e3',
      'NaN',
    ]) {
      expect(() => eurosPerUnitMicros(written), written).toThrow(RangeError);
    }
  });
});

describe('the age of a rate a closing freezes (ADR 0033)', () => {
  const codeOf = (period: string, day: string): string => {
    try {
      assertFreshRates(PayPeriodSchema.parse(period), [{ ...USD, day }]);
    } catch (error) {
      return error instanceof DomainError ? error.code : 'not a domain error';
    }
    return 'fresh';
  };

  it('takes up to four calendar days before the period’s last day, never five', () => {
    // Easter Monday on the 31st: the Thursday's rate.
    expect(codeOf('2025-03-16', '2025-03-27')).toBe('fresh');
    expect(codeOf('2025-03-16', '2025-03-26')).toBe('exchange_rate_missing_conflict');
    // The 31st of December on a Sunday: the Friday's rate, and the days before it up to four.
    expect(codeOf('2023-12-16', '2023-12-29')).toBe('fresh');
    expect(codeOf('2023-12-16', '2023-12-27')).toBe('fresh');
    expect(codeOf('2023-12-16', '2023-12-26')).toBe('exchange_rate_missing_conflict');
    // The first half of a month ends on the 15th.
    expect(codeOf('2025-02-01', '2025-02-15')).toBe('fresh');
    expect(codeOf('2025-02-01', '2025-02-10')).toBe('exchange_rate_missing_conflict');
  });

  it('says which currency has no fresh rate, and lets a period without one close', () => {
    try {
      assertFreshRates(PayPeriodSchema.parse('2025-03-16'), [{ ...USD, day: '2025-03-01' }]);
      throw new Error('no error');
    } catch (error) {
      expect(error).toMatchObject({ code: 'exchange_rate_missing_conflict', details: { currency: 'USD' } });
    }
    expect(() => {
      assertFreshRates(PayPeriodSchema.parse('2025-03-16'), []);
    }).not.toThrow();
  });
});

describe('a rate that does not come (ADR 0033)', () => {
  it('counts the weekdays whose rate should be in, never the weekend nor today', () => {
    // Friday 23 October 2026's rate, the last one.
    expect(weekdaysWithoutRate('2026-10-23', '2026-10-23')).toBe(0);
    expect(weekdaysWithoutRate('2026-10-23', '2026-10-24')).toBe(0);
    expect(weekdaysWithoutRate('2026-10-23', '2026-10-26')).toBe(0);
    expect(weekdaysWithoutRate('2026-10-23', '2026-10-27')).toBe(1);
    expect(weekdaysWithoutRate('2026-10-23', '2026-10-28')).toBe(2);
    expect(weekdaysWithoutRate('2026-10-23', '2026-10-29')).toBe(3);
    expect(weekdaysWithoutRate('2026-10-23', '2026-11-02')).toBe(5);
    // A day already past the check (a clock behind): nothing missing.
    expect(weekdaysWithoutRate('2026-10-23', '2026-10-22')).toBe(0);
  });

  it('rings after more than two weekdays without a rate: from Friday, on Thursday', () => {
    expect(isRateOverdue('2026-10-23', '2026-10-28')).toBe(false);
    expect(isRateOverdue('2026-10-23', '2026-10-29')).toBe(true);
    // A rate of three weeks ago, as a job stopped long ago leaves.
    expect(isRateOverdue('2026-10-02', '2026-10-23')).toBe(true);
  });

  it('stays quiet over the ECB’s longest closings', () => {
    // Easter 2026: Thursday 2 April, then Good Friday and Easter Monday closed. Tuesday 7 is quiet, and Wednesday 8
    // rings only if Tuesday's rate did not come either.
    expect(isRateOverdue('2026-04-02', '2026-04-07')).toBe(false);
    expect(isRateOverdue('2026-04-02', '2026-04-08')).toBe(true);
    // Christmas 2028 falls on a Monday: Friday 22 December, then the 25th and the 26th closed.
    expect(isRateOverdue('2028-12-22', '2028-12-27')).toBe(false);
    expect(isRateOverdue('2028-12-22', '2028-12-28')).toBe(true);
  });

  it('says the day in the ECB’s zone, across midnight and the change of hour', () => {
    expect(ecbDay(new Date('2026-10-28T22:30:00.000Z'))).toBe('2026-10-28');
    expect(ecbDay(new Date('2026-10-28T23:30:00.000Z'))).toBe('2026-10-29');
    // Summer time: midnight in Frankfurt is 22:00 UTC.
    expect(ecbDay(new Date('2026-07-14T21:59:00.000Z'))).toBe('2026-07-14');
    expect(ecbDay(new Date('2026-07-14T22:00:00.000Z'))).toBe('2026-07-15');
  });
});
