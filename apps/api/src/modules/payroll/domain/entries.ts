import {
  nextPayPeriod,
  payPeriodOfDay,
  previousPayPeriod,
  type PayPeriod,
  type TeamMemberId,
} from '@nirvana/contracts';

import {
  PayPeriodClosed,
  PayPeriodTooFar,
  PaymentAmountMismatch,
  PaymentBeforePeriod,
  PaymentInFuture,
  PayrollForbidden,
  PayrollOwnForbidden,
  PenaltyCancelConflict,
} from './errors';
import type { PayReader } from './ports';

/**
 * A member's bonuses, penalties and adjustments (EQ-04, ADR 0032), and the payment of a statement, their pure rules:
 * who writes them, which periods are still open for the member, which period the server chooses, which periods a write
 * locks, and what a payment may say. The transactions that apply them live in `infra/entry-store.ts`.
 */

/** What decides a member's open periods, read under the locks of the write. */
export interface MemberPayFacts {
  /** The period of the member's latest validated (or paid) statement. */
  readonly lastValidated: PayPeriod | null;
  /** The team's first and last closings (ADR 0032). */
  readonly firstClosed: PayPeriod | null;
  readonly lastClosed: PayPeriod | null;
  /** The earliest period where the member has a draft that is still open for them. */
  readonly earliestOpenDraft: PayPeriod | null;
  readonly joinedOn: string;
  /** Today's period in the agency's zone. */
  readonly current: PayPeriod;
}

/**
 * The last period closed for the member, as the database's `pay_period_closed` reads it: up to their latest validated
 * statement, and everything before the team's first closing. `null` while nothing is closed for them.
 */
export function closedUpTo(facts: Pick<MemberPayFacts, 'lastValidated' | 'firstClosed'>): PayPeriod | null {
  const beforeFirst = facts.firstClosed === null ? null : previousPayPeriod(facts.firstClosed);
  if (facts.lastValidated === null) return beforeFirst;
  if (beforeFirst === null) return facts.lastValidated;
  return facts.lastValidated > beforeFirst ? facts.lastValidated : beforeFirst;
}

export function isOpenFor(
  facts: Pick<MemberPayFacts, 'lastValidated' | 'firstClosed'>,
  period: PayPeriod,
): boolean {
  const closed = closedUpTo(facts);
  return closed === null || period > closed;
}

/**
 * Refuses, before any lock (ADR 0035), a period closed for the member or before they joined: a validated statement
 * never goes back to a draft and a closing is never erased, so a period closed now stays closed, and nothing is owed
 * before the member's arrival. A write then locks only the member's open periods up to today's; what passes here is
 * checked again under the locks.
 */
export function assertOpenBeforeLocks(
  facts: Pick<MemberPayFacts, 'lastValidated' | 'firstClosed' | 'joinedOn'>,
  period: PayPeriod,
): void {
  assertJoinedBy(facts.joinedOn, period);
  if (!isOpenFor(facts, period)) throw new PayPeriodClosed(period);
}

/** A bonus goes to today's period, an earlier one or the next one: never further, where a slip of the year lands. */
export function assertNotTooFar(period: PayPeriod, current: PayPeriod): void {
  if (period > nextPayPeriod(current)) throw new PayPeriodTooFar(period);
}

/** Nothing is owed for a period that ended before the member joined. */
export function assertJoinedBy(joinedOn: string, period: PayPeriod): void {
  if (period < payPeriodOfDay(joinedOn)) throw new PayPeriodClosed(period, { beforeJoining: true });
}

/** Only the owner or an active manager writes a member's pay, never their own (the policies say the same). */
export function assertWritesPayOf(reader: PayReader, memberId: TeamMemberId): void {
  if (reader.memberId !== null && reader.memberId === memberId) throw new PayrollOwnForbidden();
  if (reader.scope === 'self') throw new PayrollForbidden();
}

const latest = (periods: readonly PayPeriod[]): PayPeriod => {
  const [first, ...rest] = periods;
  if (first === undefined) throw new Error('No period');
  return rest.reduce((one, other) => (other > one ? other : one), first);
};

/**
 * The period an adjustment goes to, the member's first open one: where their next statement to validate is, their
 * earliest open draft or else the team's first open period (today's before any closing), never a period closed for
 * them nor one before they joined. It never reopens an old period where they had nothing.
 */
export function adjustmentPeriod(facts: MemberPayFacts): PayPeriod {
  const teamFirstOpen = facts.lastClosed === null ? facts.current : nextPayPeriod(facts.lastClosed);
  const next =
    facts.earliestOpenDraft !== null && facts.earliestOpenDraft < teamFirstOpen
      ? facts.earliestOpenDraft
      : teamFirstOpen;
  const closed = closedUpTo(facts);
  return latest([next, payPeriodOfDay(facts.joinedOn), ...(closed === null ? [] : [nextPayPeriod(closed)])]);
}

/**
 * The period a penalty's cancellation starts from: the member's first open period, or the penalty's first when it is
 * entirely open. The periods already validated keep it; `penalty_cancel_conflict` when they all are.
 */
export function penaltyCancelledFrom(
  penalty: { readonly fromPeriod: PayPeriod; readonly toPeriod: PayPeriod },
  facts: Pick<MemberPayFacts, 'lastValidated' | 'firstClosed'>,
): PayPeriod {
  const closed = closedUpTo(facts);
  const from = closed === null ? penalty.fromPeriod : latest([penalty.fromPeriod, nextPayPeriod(closed)]);
  if (from > penalty.toPeriod) throw new PenaltyCancelConflict();
  return from;
}

/**
 * The periods a write touching the member's pay from `period` on locks, in this order (ADR 0035): `period` and every
 * later one up to today's. Validating a later statement of the member closes `period` for them, so it must wait for
 * the write and see it; a period after today's has not ended, nothing validates it.
 */
export function periodsToLock(period: PayPeriod, current: PayPeriod): PayPeriod[] {
  const periods = [period];
  for (let one = nextPayPeriod(period); one <= current; one = nextPayPeriod(one)) periods.push(one);
  return periods;
}

/** The periods a write from `from` to `to` changes that pay computes now: none after today's. */
export function periodsChanged(from: PayPeriod, to: PayPeriod, current: PayPeriod): PayPeriod[] {
  const periods: PayPeriod[] = [];
  for (let one = from; one <= to && one <= current; one = nextPayPeriod(one)) periods.push(one);
  return periods;
}

/**
 * A payment as the owner records it (ADR 0023 § Factures): a transfer made, so never dated after `today` (the agency's
 * zone), nor before the first day of the statement's period (a slip of the year, which a paid statement would keep
 * forever; money may leave before the validation in Nirvana, so the bound is the period, not `validated_at`), and of
 * what the statement pays. Days compare as `YYYY-MM-DD` text, and a period is its first day.
 */
export function assertPayment(
  payment: { readonly paidOn: string; readonly sentMinor: number },
  statement: { readonly period: PayPeriod; readonly payableMinor: number },
  today: string,
): void {
  if (payment.paidOn > today) throw new PaymentInFuture(today);
  if (payment.paidOn < statement.period) throw new PaymentBeforePeriod(statement.period);
  if (payment.sentMinor !== statement.payableMinor) throw new PaymentAmountMismatch(statement.payableMinor);
}
