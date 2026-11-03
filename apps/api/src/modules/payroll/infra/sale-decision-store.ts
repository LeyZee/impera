import {
  HeldSalesSchema,
  nextPayPeriod,
  PaySaleDecisionSchema,
  TeamMemberIdSchema,
  type HeldSales,
  type PayPeriod,
  type PaySaleDecision,
} from '@nirvana/contracts';
import {
  and,
  enterCreator,
  eq,
  lockPayrollClose,
  schema,
  sql,
  withMember,
  type Database,
  type Transaction,
} from '@nirvana/db';

import { PayrollForbidden } from '../../contractors/pure';
import {
  PayEntryConflict,
  PaySaleNotFound,
  PaySaleOutcomeConflict,
  PayrollOwnForbidden,
} from '../domain/errors';
import type { PayrollSaleDecisionStore } from '../domain/ports';
import { salesToDecide, saleToDecide, type PeriodPlace, type SaleToDecide } from '../domain/sales';

import { enqueuePayRecalculation } from './recalculation-queue';
import { readPeriodSales, type PeriodSales } from './sales-reads';
import { closingsSpan, type PayInputReads } from './snapshot';
import { audit } from './writes';

const { payPeriodClosings, paySaleDecisions, teamMembers } = schema;

const decisionOfRow = (row: typeof paySaleDecisions.$inferSelect): PaySaleDecision =>
  PaySaleDecisionSchema.parse({
    id: row.id,
    platform: row.platform,
    platformSaleId: row.platformSaleId,
    revision: row.revision,
    platformAccountId: row.platformAccountId,
    outcome: row.outcome,
    reason: row.reason,
    memberId: row.authorMemberId,
    note: row.note,
    decidedBy: row.decidedBy,
    createdAt: row.createdAt.toISOString(),
  });

/** A line to decide as the owner and an active manager read it, with the decision in force and what may be decided. */
const heldSaleOf = (one: SaleToDecide): HeldSales['sales'][number] => ({
  platform: one.line.platform,
  platformSaleId: one.line.platformSaleId,
  event: one.line.event,
  platformAccountId: one.line.platformAccountId,
  status: one.line.status,
  occurredAt: one.line.occurredAt.toISOString(),
  saleOccurredAt: one.line.saleOccurredAt?.toISOString() ?? null,
  salePeriod: one.line.salePeriod,
  currency: one.line.currency,
  netMinor: one.line.netMinor,
  memberId: one.line.author.kind === 'member' ? one.line.author.memberId : null,
  reason: one.reason,
  decision: one.decision,
  outcomes: [...one.outcomes],
});

interface PeriodSalesRead extends PeriodSales {
  readonly place: PeriodPlace;
  readonly creatorIds: readonly string[];
}

/**
 * `period`'s sales as the member reads them, creator by creator (as a closing does), and where they stand: before the
 * team's first closing, a period is read as the one that would close first, its earlier held lines with it.
 */
async function periodSalesOf(
  tx: Transaction,
  reads: PayInputReads,
  period: PayPeriod,
): Promise<PeriodSalesRead> {
  const { last } = await closingsSpan(tx);
  const [closing] = await tx
    .select({ period: payPeriodClosings.period })
    .from(payPeriodClosings)
    .where(eq(payPeriodClosings.period, period));
  const closed = closing !== undefined;
  const creatorIds = await reads.creatorIds();
  const read = await readPeriodSales(
    tx,
    reads.sales,
    period,
    { closed, lastClosed: last },
    { kind: 'member', creatorIds },
    await reads.agencyTimeZone(tx),
  );
  return {
    ...read,
    creatorIds,
    place: { period, closed, firstOpen: last === null ? period : nextPayPeriod(last) },
  };
}

/** The signed-in account's member, `null` for the owner outside the team. */
async function ownMemberOf(tx: Transaction, userId: string): Promise<string | null> {
  const [own] = await tx
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  return own === undefined ? null : TeamMemberIdSchema.parse(own.id);
}

/**
 * The sales an open period holds or a decision settles, and the validator's decisions (CRM-03 lot b3, ADR 0050 § 5),
 * as the member who reads or decides (`withMember`): the policies keep the four eyes and the decisions added only, the
 * triggers a sale of the register never decided once a closing counted it, and a `withdraw` only after a decision.
 */
export function createDrizzleSaleDecisionStore(db: Database, reads: PayInputReads): PayrollSaleDecisionStore {
  return {
    heldSales: (userId, period) =>
      withMember(db, userId, async (tx, scope) => {
        if (scope === 'self') throw new PayrollForbidden();
        const { sales, place } = await periodSalesOf(tx, reads, period);
        return HeldSalesSchema.parse({ period, sales: salesToDecide(sales, place).map(heldSaleOf) });
      }),

    decide: (actor, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        if (scope === 'self') throw new PayrollForbidden();
        // A closing and a decision on the same sale never cross: each sees the other, or comes after it.
        await lockPayrollClose(tx);
        const [sent] = await tx.select().from(paySaleDecisions).where(eq(paySaleDecisions.id, body.id));
        if (sent !== undefined) {
          const same =
            sent.platform === body.platform &&
            sent.platformSaleId === body.platformSaleId &&
            sent.outcome === body.outcome &&
            sent.note === body.note;
          if (!same) throw new PayEntryConflict('pay_sale_decision_conflict');
          return { value: decisionOfRow(sent), created: false };
        }

        const { sales, place, creatorOfAccount, creatorIds } = await periodSalesOf(tx, reads, body.period);
        const target = saleToDecide(sales, place, body);
        if (target === null) throw new PaySaleNotFound();
        if (!target.outcomes.includes(body.outcome)) throw new PaySaleOutcomeConflict(target.outcomes);
        const { author } = target.line;
        const authorMemberId = author.kind === 'member' ? author.memberId : null;
        if (authorMemberId !== null && authorMemberId === (await ownMemberOf(tx, actor.userId))) {
          throw new PayrollOwnForbidden();
        }
        const creatorId = creatorOfAccount.get(target.line.platformAccountId);
        if (creatorId === undefined) throw new Error('A sale to decide was not read in a creator');
        // The trigger reads the register under the writer's policies: the line's creator is entered.
        await enterCreator(tx, creatorId, creatorIds);
        const [latest] = await tx
          .select({ revision: sql<number>`coalesce(max(${paySaleDecisions.revision}), 0)::int` })
          .from(paySaleDecisions)
          .where(
            and(
              eq(paySaleDecisions.platform, body.platform),
              eq(paySaleDecisions.platformSaleId, body.platformSaleId),
            ),
          );
        const [row] = await tx
          .insert(paySaleDecisions)
          .values({
            id: body.id,
            platform: body.platform,
            platformSaleId: body.platformSaleId,
            revision: (latest?.revision ?? 0) + 1,
            platformAccountId: target.line.platformAccountId,
            outcome: body.outcome,
            reason: target.reason,
            authorMemberId,
            linkVersion: author.kind === 'member' ? author.linkVersion : null,
            note: body.note,
            decidedBy: actor.userId,
          })
          .returning();
        if (row === undefined) throw new Error('A decision was not written');
        await audit(
          tx,
          actor,
          'pay_sale_decision.create',
          { kind: 'pay_sale_decision', id: row.id },
          { period: body.period, outcome: body.outcome, revision: row.revision },
        );
        await enqueuePayRecalculation(tx, body.period);
        return { value: decisionOfRow(row), created: true };
      }),
  };
}
