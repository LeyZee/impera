import {
  nextPayPeriod,
  payPeriodOfDay,
  type CommissionStatementStatus,
  type PayPeriod,
  type TeamMemberId,
} from '@nirvana/contracts';

import {
  CommissionStatementChanged,
  CommissionStatementOpen,
  CommissionStatementStatusConflict,
  PayrollForbidden,
  PayrollOwnForbidden,
} from './errors';
import type { PayReader } from './ports';

/**
 * The validation of a statement (EQ-04, ADR 0032), its pure rules: who validates what, and which earlier periods the
 * team or the member must have settled first. The transaction that applies them lives in `infra/validation-store.ts`.
 */

/** A statement as the validation reads it, under `payroll.close`. */
export interface StatementHead {
  readonly memberId: TeamMemberId;
  readonly period: PayPeriod;
  readonly status: CommissionStatementStatus;
  readonly revision: number;
  readonly inputsHash: string;
}

/**
 * Whether `reader` may validate `head` now, with the reason when not, as `mayValidateStatement` tells the screen:
 * never one's own, the owner or an active manager only, a draft, the revision shown, a period that has ended.
 */
export function assertValidates(
  head: StatementHead,
  reader: PayReader,
  revision: number,
  endsAt: Date,
  now: Date,
): void {
  if (reader.memberId !== null && reader.memberId === head.memberId) throw new PayrollOwnForbidden();
  if (reader.scope === 'self') throw new PayrollForbidden();
  if (head.status !== 'draft') throw new CommissionStatementStatusConflict();
  if (head.revision !== revision) throw new CommissionStatementChanged(head.period);
  if (endsAt > now) throw new CommissionStatementOpen();
}

/**
 * Before the team's first closing, the period that closes first: the earliest that has anything to pay (a statement, a
 * report no closing counted, a bonus, a penalty, an adjustment). `null` when `period` may be the first: an earlier one
 * would otherwise never be computed again (ADR 0032), and what it holds would go unpaid.
 */
export function periodBeforeFirstClosing(
  period: PayPeriod,
  earliestWithPay: readonly (PayPeriod | null)[],
): PayPeriod | null {
  const earlier = earliestWithPay.filter((one): one is PayPeriod => one !== null && one < period).sort();
  return earlier[0] ?? null;
}

/**
 * The closed periods before `period` where the member may be owed a statement pay has not written yet (the job runs a
 * few seconds after a closing): from the latest of the team's first closing, the period after the member's last
 * validated statement and the period they joined in. Each is computed again before the member's later one validates,
 * or that statement could never be written: the database refuses a draft behind a validated one.
 */
export function periodsOwedBefore(
  period: PayPeriod,
  facts: {
    readonly firstClosed: PayPeriod;
    readonly lastValidated: PayPeriod | null;
    readonly joinedOn: string;
  },
): PayPeriod[] {
  const from = [
    facts.firstClosed,
    facts.lastValidated === null ? facts.firstClosed : nextPayPeriod(facts.lastValidated),
    payPeriodOfDay(facts.joinedOn),
  ].sort()[2];
  const periods: PayPeriod[] = [];
  for (let one = from ?? period; one < period; one = nextPayPeriod(one)) periods.push(one);
  return periods;
}
