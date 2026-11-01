import { PayPeriodBlockSchema, type PayPeriod, type PayPeriodBlock } from '@nirvana/contracts';
import { eq, schema, type Transaction } from '@nirvana/db';

import { sameReason } from '../domain/period-blocks';
import type { PeriodDecision } from '../domain/ports';

const { payPeriodBlocks } = schema;

/** A row of `pay_period_blocks` as the contract reads it: its reason, and since when. */
export function blockOfRow(row: typeof payPeriodBlocks.$inferSelect): PayPeriodBlock {
  return PayPeriodBlockSchema.parse(
    row.code === 'commission_rate_missing_conflict'
      ? { code: row.code, memberIds: row.memberIds, since: row.since.toISOString() }
      : { code: row.code, currency: row.currency, since: row.since.toISOString() },
  );
}

/**
 * Records what the recalculation of `period` decided about its block (recette du 28/10, Équipe G1), in its transaction,
 * under `payroll.close` (ADR 0032): a computation that passes, or a period never computed again, lifts the block; a
 * refusal the period records writes its reason, from `at` when it changed and from when it began while it holds, so
 * that a replay writes nothing. A refusal the period does not record leaves the block as it is: the period is still
 * not computed.
 */
export async function recordBlock(
  tx: Transaction,
  period: PayPeriod,
  decision: PeriodDecision,
  at: Date,
): Promise<void> {
  const [was] = await tx.select().from(payPeriodBlocks).where(eq(payPeriodBlocks.period, period));
  if (decision.kind !== 'blocked') {
    if (was !== undefined) await tx.delete(payPeriodBlocks).where(eq(payPeriodBlocks.period, period));
    return;
  }
  const { reason } = decision;
  if (reason === null || (was !== undefined && sameReason(blockOfRow(was), reason))) return;
  const values =
    reason.code === 'commission_rate_missing_conflict'
      ? { code: reason.code, memberIds: [...reason.memberIds], currency: null, since: at }
      : { code: reason.code, memberIds: null, currency: reason.currency, since: at };
  await tx
    .insert(payPeriodBlocks)
    .values({ period, ...values })
    .onConflictDoUpdate({ target: payPeriodBlocks.period, set: values });
}
