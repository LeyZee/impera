import { BonusTierSchema, payPeriodAt, PayPeriodSchema, type TeamMemberId } from '@impera/contracts';
import { and, eq, schema, sql, type Transaction } from '@impera/db';

import { payGameFacts, type PayGameFacts, type TierReached } from '../domain/game-facts';

import { figureLinesOf } from './sale-signal-store';

const { commissionStatements } = schema;

/**
 * What the game reads of a member's pay (ADR 0104 § 12 and § 15), in the game's own job: the module owns the
 * statements, the game gets this function through the module's `index.ts`, never the tables. On the admin connection,
 * a read bounded to that job; nothing is written (§ 17).
 */
export async function payGameFactsUnscoped(
  tx: Transaction,
  memberId: TeamMemberId,
  agencyZone: string,
  now: Date,
): Promise<PayGameFacts> {
  const rows = await tx
    .select({ period: commissionStatements.period, tierBonus: commissionStatements.tierBonus })
    .from(commissionStatements)
    .where(
      and(eq(commissionStatements.memberId, memberId), sql`${commissionStatements.tierBonus} is not null`),
    );
  const tiers: TierReached[] = rows.map((row) => ({
    period: PayPeriodSchema.parse(row.period),
    thresholdMinor: BonusTierSchema.parse(row.tierBonus).thresholdMinor,
  }));
  return payGameFacts({
    lines: await figureLinesOf(tx, memberId),
    tiers,
    agencyZone,
    currentPeriod: payPeriodAt(now, agencyZone),
  });
}
