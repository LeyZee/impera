import { nextPayPeriod, payPeriodOfDay, type PayPeriod } from '@nirvana/contracts';

import { CommissionStatementDocumentsOpen } from './errors';

/**
 * A member who left, as pay sees him (EQ-14 lot 1, ADR 0039 § 6). The period that holds the day he left is his
 * departure fortnight, computed and validated as any other. The period after it is his closing fortnight: pay gives him
 * a statement there even without activity, so that the corrections of his last documents, which their contests bring
 * after the departure fortnight is validated, land on it (a correction goes on his first open period). From the closing
 * fortnight on, each statement of his is final: no payout minimum, every carry-over paid (ADR 0038); and it is validated
 * only once none of his documents awaits an answer or stays contested. The base checks both (`keep_final_statement`).
 */

/** His closing fortnight: the period after the one that holds `leftOn`; `null` while he has not left. */
export function closingPeriodOf(leftOn: string | null): PayPeriod | null {
  return leftOn === null ? null : nextPayPeriod(payPeriodOfDay(leftOn));
}

/** Whether his statement of `period` is final: from his closing fortnight on. */
export function finalFor(leftOn: string | null, period: PayPeriod): boolean {
  const closing = closingPeriodOf(leftOn);
  return closing !== null && period >= closing;
}

/**
 * A final statement is validated only once none of the member's documents is open, `open` of them being issued and
 * neither accepted, lapsed nor, contested, ended: a contest still to come or to decide would have no period left to
 * correct it in the member's pay.
 */
export function assertDocumentsSettled(final: boolean, open: number): void {
  if (final && open > 0) throw new CommissionStatementDocumentsOpen(open);
}
