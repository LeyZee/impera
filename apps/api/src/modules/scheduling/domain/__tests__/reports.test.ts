import { DomainError, PayPeriodSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  assertChanges,
  assertDeclarable,
  assertReportOpen,
  assertReportValues,
  assertReviews,
  assertTotalHolds,
  canReview,
  makerOf,
  reportOpensAt,
  shiftPeriod,
  type Reader,
  type ReportFacts,
} from '../reports';

const at = (value: string): Date => new Date(value);
const period = (day: string) => PayPeriodSchema.parse(day);

/** The code a rule throws on these arguments, or `null`. */
function codeOf<Args extends unknown[]>(rule: (...args: Args) => unknown, ...args: Args): string | null {
  try {
    rule(...args);
  } catch (error) {
    return error instanceof DomainError ? error.code : 'unexpected';
  }
  return null;
}

describe('the period of a shift (ADR 0023)', () => {
  it('puts a shift that starts on the 15th at 23:00 in the agency’s zone in the first fortnight', () => {
    // 23:00 in Paris on 15 October (summer time) is 21:00 UTC.
    expect(shiftPeriod(at('2026-10-15T21:00:00Z'), 'Europe/Paris')).toBe('2026-10-01');
  });

  it('reads the day in the agency’s zone, not in UTC', () => {
    // 23:30 UTC on 15 November is 00:30 on the 16th in Paris (winter time): the second fortnight.
    expect(shiftPeriod(at('2026-11-15T23:30:00Z'), 'Europe/Paris')).toBe('2026-11-16');
    expect(shiftPeriod(at('2026-11-15T23:30:00Z'), 'UTC')).toBe('2026-11-01');
  });
});

describe('when a shift takes its report', () => {
  const shift = { startsAt: at('2026-10-28T23:00:00Z'), endsAt: at('2026-10-29T05:00:00Z') };

  it('opens 30 minutes before the end, never before the start', () => {
    expect(reportOpensAt(shift)).toEqual(at('2026-10-29T04:30:00Z'));
    const short = { startsAt: at('2026-10-29T04:50:00Z'), endsAt: at('2026-10-29T05:10:00Z') };
    expect(reportOpensAt(short)).toEqual(short.startsAt);
  });

  it('refuses a report made earlier, and takes a late one', () => {
    expect(codeOf(assertReportOpen, shift, at('2026-10-29T04:29:00Z'))).toBe('shift_report_early_conflict');
    expect(codeOf(assertReportOpen, shift, at('2026-10-29T04:30:00Z'))).toBeNull();
    expect(codeOf(assertReportOpen, shift, at('2026-12-01T00:00:00Z'))).toBeNull();
  });
});

describe('what a report declares in', () => {
  const rules = [
    { fromPeriod: period('2026-10-01'), currency: 'EUR' as const, earningsSource: 'declared' as const },
    { fromPeriod: period('2026-12-01'), currency: 'EUR' as const, earningsSource: 'detected' as const },
  ];

  it('needs the account’s rules for the period, in their currency', () => {
    expect(codeOf(assertDeclarable, rules, period('2026-10-16'), 'EUR')).toBeNull();
    expect(codeOf(assertDeclarable, rules, period('2026-09-16'), 'EUR')).toBe('pay_rules_missing_conflict');
    expect(codeOf(assertDeclarable, rules, period('2026-10-16'), 'USD')).toBe(
      'shift_report_currency_conflict',
    );
  });

  it('refuses a declared amount on a period that reads the detected sales: never both', () => {
    expect(codeOf(assertDeclarable, rules, period('2026-12-01'), 'EUR')).toBe(
      'shift_report_detected_conflict',
    );
  });
});

describe('the amounts', () => {
  it('holds a report at 0 or more, a correction away from 0 and without an incident', () => {
    expect(codeOf(assertReportValues, { correctsId: null, amountMinor: 0, incident: 'Panne' })).toBeNull();
    expect(codeOf(assertReportValues, { correctsId: null, amountMinor: -1, incident: null })).toBe(
      'request_invalid',
    );
    expect(codeOf(assertReportValues, { correctsId: 'r', amountMinor: 0, incident: null })).toBe(
      'request_invalid',
    );
    expect(codeOf(assertReportValues, { correctsId: 'r', amountMinor: -5, incident: 'Panne' })).toBe(
      'request_invalid',
    );
  });

  it('never lets the shift’s validated total go below 0, the row checked counted once', () => {
    const report = { id: 'report', status: 'validated' as const, amountMinor: 10_000 };
    const first = { id: 'first', status: 'validated' as const, amountMinor: -8_000 };
    const second = { id: 'second', status: 'submitted' as const, amountMinor: -6_000 };
    expect(codeOf(assertTotalHolds, [report, first, second], second)).toBe('shift_report_total_conflict');
    expect(codeOf(assertTotalHolds, [report, second], second)).toBeNull();
    expect(codeOf(assertTotalHolds, [report, first], first)).toBeNull();
  });
});

describe('who makes, changes and reviews (four eyes)', () => {
  const owner: Reader = { userId: 'owner', scope: 'owner', memberId: null };
  const manager: Reader = { userId: 'manager', scope: 'agency', memberId: 'm-manager' };
  const chatter: Reader = { userId: 'chatter', scope: 'self', memberId: 'm-chatter' };
  const colleague: Reader = { userId: 'colleague', scope: 'self', memberId: 'm-colleague' };
  const report: ReportFacts = {
    memberId: 'm-chatter',
    byAgency: false,
    status: 'submitted',
    version: 2,
    submittedBy: 'chatter',
  };

  it('the shift’s member makes the report; the agency only corrects', () => {
    expect(makerOf('m-chatter', false, chatter)).toEqual({ byAgency: false });
    expect(makerOf('m-chatter', true, chatter)).toEqual({ byAgency: false });
    expect(makerOf('m-chatter', true, manager)).toEqual({ byAgency: true });
    expect(codeOf(makerOf, 'm-chatter', false, manager)).toBe('shift_report_forbidden');
    expect(codeOf(makerOf, 'm-chatter', true, colleague)).toBe('shift_report_forbidden');
  });

  it('its maker changes it until it is validated, from the version read', () => {
    expect(codeOf(assertChanges, report, 2, chatter)).toBeNull();
    expect(codeOf(assertChanges, report, 1, chatter)).toBe('shift_report_changed_conflict');
    expect(codeOf(assertChanges, report, 2, manager)).toBe('shift_report_forbidden');
    expect(codeOf(assertChanges, { ...report, status: 'validated' }, 2, chatter)).toBe(
      'shift_report_validated_conflict',
    );
    const agencys = { ...report, byAgency: true, submittedBy: 'manager' };
    expect(codeOf(assertChanges, agencys, 2, owner)).toBeNull();
    expect(codeOf(assertChanges, agencys, 2, chatter)).toBe('shift_report_forbidden');
  });

  it('the agency reviews the version it read, never its own shift nor, as a manager, what it sent', () => {
    expect(codeOf(assertReviews, report, 2, manager)).toBeNull();
    expect(codeOf(assertReviews, report, 1, manager)).toBe('shift_report_changed_conflict');
    expect(codeOf(assertReviews, { ...report, status: 'rejected' }, 2, manager)).toBe(
      'shift_report_changed_conflict',
    );
    expect(codeOf(assertReviews, report, 2, chatter)).toBe('shift_report_forbidden');
    const managersShift = { ...report, memberId: 'm-manager', submittedBy: 'manager' };
    expect(codeOf(assertReviews, managersShift, 2, manager)).toBe('shift_report_own_review_forbidden');
    const managersCorrection = { ...report, byAgency: true, submittedBy: 'manager' };
    expect(codeOf(assertReviews, managersCorrection, 2, manager)).toBe('shift_report_own_review_forbidden');
    const ownersCorrection = { ...report, byAgency: true, submittedBy: 'owner' };
    expect(codeOf(assertReviews, ownersCorrection, 2, owner)).toBeNull();
    expect(canReview(managersCorrection, owner)).toBe(true);
    expect(canReview(report, chatter)).toBe(false);
  });
});
