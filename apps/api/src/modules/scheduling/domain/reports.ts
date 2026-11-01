import {
  mayReviewShiftReport,
  payPeriodOfDay,
  payRulesFor,
  SHIFT_REPORT_OPENS_BEFORE_END_MINUTES,
  validatedTotalWith,
  type Currency,
  type EarningsSource,
  type PayPeriod,
  type ShiftReportStatus,
  type TeamScope,
} from '@nirvana/contracts';

import {
  PayRulesMissing,
  ShiftReportChanged,
  ShiftReportCurrency,
  ShiftReportDetected,
  ShiftReportEarly,
  ShiftReportForbidden,
  ShiftReportInvalid,
  ShiftReportOwnReview,
  ShiftReportTotal,
  ShiftReportValidated,
} from './errors';
import { calendarDayIn } from './time';

/** End-of-shift reports (EQ-03, contract `shift-reports.ts`), pure. */

const MINUTE_MS = 60_000;

/** The pay period a shift belongs to: the one it starts in, in the agency's zone (ADR 0023). */
export function shiftPeriod(startsAt: Date, timeZone: string): PayPeriod {
  return payPeriodOfDay(calendarDayIn(startsAt, timeZone));
}

/** From when a shift takes its report: `SHIFT_REPORT_OPENS_BEFORE_END_MINUTES` before its end, never before it starts. */
export function reportOpensAt(shift: { readonly startsAt: Date; readonly endsAt: Date }): Date {
  const before = shift.endsAt.getTime() - SHIFT_REPORT_OPENS_BEFORE_END_MINUTES * MINUTE_MS;
  return new Date(Math.max(before, shift.startsAt.getTime()));
}

export function assertReportOpen(shift: { readonly startsAt: Date; readonly endsAt: Date }, now: Date): void {
  const opensAt = reportOpensAt(shift);
  if (now.getTime() < opensAt.getTime()) throw new ShiftReportEarly(opensAt);
}

export interface RulesRow {
  readonly fromPeriod: PayPeriod;
  readonly currency: Currency;
  readonly earningsSource: EarningsSource;
}

/**
 * What a report of `period` declares in, from the account's rules: refused without rules for the period, when the
 * period reads the detected sales, and in another currency.
 */
export function assertDeclarable(rules: readonly RulesRow[], period: PayPeriod, currency: Currency): void {
  const inForce = payRulesFor(rules, period);
  if (inForce === null) throw new PayRulesMissing();
  if (inForce.earningsSource === 'detected') throw new ShiftReportDetected();
  if (inForce.currency !== currency) throw new ShiftReportCurrency();
}

/** The rows of a shift as the totals read them. */
export interface ReportAmount {
  readonly id: string;
  readonly status: ShiftReportStatus;
  readonly amountMinor: number;
}

const asTotalRows = (reports: readonly ReportAmount[]) =>
  reports.map((one) => ({ id: one.id, status: one.status, amount: { amountMinor: one.amountMinor } }));

/** A correction never takes the shift's validated total below 0, once validated too. */
export function assertTotalHolds(shiftReports: readonly ReportAmount[], next: ReportAmount): void {
  if (
    validatedTotalWith(asTotalRows(shiftReports), {
      id: next.id,
      amount: { amountMinor: next.amountMinor },
    }) < 0
  ) {
    throw new ShiftReportTotal();
  }
}

/** What a report or a correction says of its amount and incident, as Zod holds it at `POST`. */
export function assertReportValues(values: {
  readonly correctsId: string | null;
  readonly amountMinor: number;
  readonly incident: string | null;
}): void {
  if (values.correctsId === null && values.amountMinor < 0) {
    throw new ShiftReportInvalid('Un rapport déclare 0 ou plus');
  }
  if (values.correctsId !== null && values.amountMinor === 0) {
    throw new ShiftReportInvalid('Une correction change le montant');
  }
  if (values.correctsId !== null && values.incident !== null) {
    throw new ShiftReportInvalid('Un incident se signale sur le rapport');
  }
}

/** Who reads, as a report's rules need them: their scope, their own member row, their account. */
export interface Reader {
  readonly userId: string;
  readonly scope: TeamScope;
  readonly memberId: string | null;
}

/** The owner or an active manager: who plans, corrects in the agency's name and reviews. */
export const isAgency = (reader: Reader): boolean => reader.scope === 'owner' || reader.scope === 'agency';

/** The report as the review and the maker's rules read it. */
export interface ReportFacts {
  readonly memberId: string;
  readonly byAgency: boolean;
  readonly status: ShiftReportStatus;
  readonly version: number;
  readonly submittedBy: string;
}

/** `canReview` of the contract, for this reader. */
export function canReview(report: ReportFacts, reader: Reader): boolean {
  return mayReviewShiftReport({
    status: report.status,
    readerIsAgency: isAgency(reader),
    readerIsOwner: reader.scope === 'owner',
    readerIsShiftMember: report.memberId === reader.memberId,
    readerMadeIt: report.submittedBy === reader.userId,
  });
}

/**
 * A review names the version it read, of a submitted report, by someone who may review it: the owner or an active
 * manager, never on their own shift nor, as a manager, on what they sent.
 */
export function assertReviews(report: ReportFacts, version: number, reader: Reader): void {
  if (!isAgency(reader)) throw new ShiftReportForbidden();
  if (report.status !== 'submitted' || report.version !== version) throw new ShiftReportChanged();
  if (!canReview(report, reader)) throw new ShiftReportOwnReview();
}

/**
 * Its maker changes it: the shift's member for what they made, the owner or an active manager for the agency's
 * correction; only while it is not validated, and from the version the screen read.
 */
export function assertChanges(report: ReportFacts, version: number, reader: Reader): void {
  const maker = report.byAgency ? isAgency(reader) : report.memberId === reader.memberId;
  if (!maker) throw new ShiftReportForbidden();
  if (report.status === 'validated') throw new ShiftReportValidated();
  if (report.version !== version) throw new ShiftReportChanged();
}

/**
 * Who makes what: the shift's member makes its report and may correct it; the owner or an active manager only
 * corrects, in the agency's name. `byAgency` of the new row.
 */
export function makerOf(shiftMemberId: string, correcting: boolean, reader: Reader): { byAgency: boolean } {
  if (shiftMemberId === reader.memberId) return { byAgency: false };
  if (correcting && isAgency(reader)) return { byAgency: true };
  throw new ShiftReportForbidden();
}
