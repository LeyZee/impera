import { payPeriodOfDay, type PayPeriod } from '@impera/contracts';

/**
 * A member who left, as pay sees him (EQ-14, ADR 0072). The period that holds the day he left is his departure
 * fortnight: computed, validated, invoiced and paid at the normal cycle, and his final statement. Each statement of his
 * from it on is final: no payout minimum, every carry-over paid (ADR 0038), and a total below zero written off instead
 * of carried (`computeCommissionStatements`). A later period gives him a statement only when something lands in it: a
 * contest's correction, a sale or a refund recorded after the departure fortnight was validated, an adjustment. His
 * open documents never hold a final statement back: a contest's correction goes on his first open period (ADR 0072
 * § 3). The base checks that only such a statement is final (`keep_final_statement`).
 */

/** His departure fortnight: the period that holds `leftOn`; `null` while he has not left. */
export function departurePeriodOf(leftOn: string | null): PayPeriod | null {
  return leftOn === null ? null : payPeriodOfDay(leftOn);
}

/** Whether his statement of `period` is final: from his departure fortnight on. */
export function finalFor(leftOn: string | null, period: PayPeriod): boolean {
  const departure = departurePeriodOf(leftOn);
  return departure !== null && period >= departure;
}
