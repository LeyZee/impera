import type { PayPeriod } from '@impera/contracts';
import { schema, sql, type Transaction } from '@impera/db';

const { payPeriodClosings } = schema;

/**
 * Whether a period is closed at or after `period` (ADR 0084 § 2), in the caller's transaction: pay has counted it, so
 * its base never changes, and rules from the checked fortnight are refused. `team_read` opens the closings to every
 * member: the owner who sets the rules reads them under her own context.
 */
async function closedFrom(tx: Transaction, period: PayPeriod): Promise<boolean> {
  const [row] = await tx
    .select({ period: payPeriodClosings.period })
    .from(payPeriodClosings)
    .where(sql`${payPeriodClosings.period} >= ${period}::date`)
    .limit(1);
  return row !== undefined;
}

/** @public What the pay rules of the planning read of pay, plugged by the composition root (ADR 0084). */
export const payReadsForPayRules = { closedFrom };
