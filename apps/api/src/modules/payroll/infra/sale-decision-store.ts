import {
  calendarDayAt,
  HeldSalesSchema,
  nextPayPeriod,
  payPeriodLastDay,
  PaySaleDecisionSchema,
  PayPeriodSchema,
  PlatformSchema,
  SALE_WHOLE_BP,
  SaleEventSchema,
  SaleGiftCountsSchema,
  SaleSignalKindSchema,
  SalesToGiveSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type HeldSales,
  type PayPeriod,
  type PaySaleDecision,
  type TeamMemberId,
} from '@impera/contracts';
import {
  and,
  enterCreator,
  eq,
  inArray,
  lockPayrollClose,
  schema,
  sql,
  withMember,
  type Database,
  type Transaction,
} from '@impera/db';
import { z } from 'zod';

import { PayrollForbidden } from '../../contractors/pure';
import { finalFor } from '../domain/departure';
import {
  PayEntryConflict,
  PaySaleNotFound,
  PaySaleOutcomeConflict,
  PaySaleRecipientConflict,
  PayrollOwnForbidden,
} from '../domain/errors';
import type { PayrollSaleDecisionStore } from '../domain/ports';
import type { MemberForPay } from '../domain/recalculation';
import {
  saleKeyOf,
  salesToDecide,
  salesToGive,
  saleToDecide,
  type PeriodPlace,
  type SaleSignalForPay,
  type SaleSignals,
  type SaleToDecide,
} from '../domain/sales';

import { enqueuePayRecalculation } from './recalculation-queue';
import { readPeriodSales, type PeriodSales } from './sales-reads';
import { closingsSpan, type PayInputReads } from './snapshot';
import { audit } from './writes';

const { commissionStatements, payPeriodClosings, paySaleDecisions, paySaleSignals, teamMembers } = schema;

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
    recipientMemberId: row.recipientMemberId,
    shareBp: row.shareBp,
    excludeReason: row.excludeReason,
    note: row.note,
    decidedBy: row.decidedBy,
    createdAt: row.createdAt.toISOString(),
  });

/**
 * A line to decide as the owner and an active manager read it, with the decision in force and what may be decided, the
 * day its member left (`leftOn`, by member), and the members a give may name, less those the reader may not (`barred`:
 * the reader, the members gone with a validated final statement).
 */
const heldSaleOf = (
  one: SaleToDecide,
  leftOn: ReadonlyMap<TeamMemberId, string | null>,
  barred: ReadonlySet<TeamMemberId>,
): HeldSales['sales'][number] => ({
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
  memberLeftOn: one.line.author.kind === 'member' ? (leftOn.get(one.line.author.memberId) ?? null) : null,
  platformChatterId: one.line.platformChatterId,
  byAgent: one.line.author.kind === 'agent',
  reason: one.reason,
  decision: one.decision?.outcome ?? null,
  given:
    one.decision?.outcome === 'give' && one.decision.memberId !== null && one.decision.note !== null
      ? { recipientMemberId: one.decision.memberId, shareBp: one.decision.shareBp, note: one.decision.note }
      : null,
  excludeReason: one.decision?.outcome === 'exclude' ? one.decision.excludeReason : null,
  outcomes: [...one.outcomes],
  recipients: one.recipients.filter((member) => !barred.has(member)),
  signal:
    one.signal === null
      ? null
      : {
          memberId: one.signal.memberId,
          note: one.signal.note,
          signalledAt: one.signal.signalledAt.toISOString(),
        },
});

const SignalRowSchema = z.object({
  platform: PlatformSchema,
  platformSaleId: z.string().min(1),
  event: SaleEventSchema,
  memberId: TeamMemberIdSchema,
  kind: SaleSignalKindSchema,
  note: z.string().nullable(),
  createdAt: z.date(),
});

/**
 * The members' signals in force on `period`'s lines (CRM-03 lot b4c), by line: the latest of each line and member, when
 * it is a `signal`. Read as the validator: the domain keeps the one of the member the line would pay.
 */
async function signalsIn(tx: Transaction, period: PayPeriod): Promise<SaleSignals> {
  const rows = await tx
    .selectDistinctOn(
      [paySaleSignals.platform, paySaleSignals.platformSaleId, paySaleSignals.event, paySaleSignals.memberId],
      {
        platform: paySaleSignals.platform,
        platformSaleId: paySaleSignals.platformSaleId,
        event: paySaleSignals.event,
        memberId: paySaleSignals.memberId,
        kind: paySaleSignals.kind,
        note: paySaleSignals.note,
        createdAt: paySaleSignals.createdAt,
      },
    )
    .from(paySaleSignals)
    .where(eq(paySaleSignals.period, period))
    .orderBy(
      paySaleSignals.platform,
      paySaleSignals.platformSaleId,
      paySaleSignals.event,
      paySaleSignals.memberId,
      sql`${paySaleSignals.revision} desc`,
    );
  const signals = new Map<string, SaleSignalForPay[]>();
  for (const row of rows) {
    const one = SignalRowSchema.parse(row);
    if (one.kind !== 'signal') continue;
    const key = saleKeyOf(one);
    signals.set(key, [
      ...(signals.get(key) ?? []),
      { memberId: one.memberId, note: one.note, signalledAt: one.createdAt },
    ]);
  }
  return signals;
}

interface PeriodSalesRead extends PeriodSales {
  readonly place: PeriodPlace;
  readonly creatorIds: readonly string[];
  readonly timeZone: string;
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
  const timeZone = await reads.agencyTimeZone(tx);
  const read = await readPeriodSales(
    tx,
    reads.sales,
    period,
    { closed, lastClosed: last },
    { kind: 'member', creatorIds },
    timeZone,
  );
  return {
    ...read,
    creatorIds,
    timeZone,
    place: { period, closed, firstOpen: last === null ? period : nextPayPeriod(last) },
  };
}

/**
 * Among `members`, those who left and whose final statement is validated or paid (ADR 0072): a sale is never given to
 * them (ADR 0101 § 4), as a sale of theirs after it waits.
 */
async function goneForGood(tx: Transaction, members: readonly MemberForPay[]): Promise<Set<TeamMemberId>> {
  const leftOn = new Map(members.filter((one) => one.leftOn !== null).map((one) => [one.id, one.leftOn]));
  if (leftOn.size === 0) return new Set();
  const rows = await tx
    .select({ memberId: commissionStatements.memberId, period: commissionStatements.period })
    .from(commissionStatements)
    .where(
      and(
        inArray(commissionStatements.memberId, [...leftOn.keys()]),
        inArray(commissionStatements.status, ['validated', 'paid']),
      ),
    );
  const gone = new Set<TeamMemberId>();
  for (const row of rows) {
    const memberId = TeamMemberIdSchema.parse(row.memberId);
    if (finalFor(leftOn.get(memberId) ?? null, PayPeriodSchema.parse(row.period))) gone.add(memberId);
  }
  return gone;
}

/** Who a give may not name, whatever the shifts say: the reader, and the members gone for good (`goneForGood`). */
async function barredOf(
  tx: Transaction,
  reads: PayInputReads,
  period: PayPeriod,
  own: TeamMemberId | null,
): Promise<Set<TeamMemberId>> {
  const barred = await goneForGood(tx, await reads.members(tx, payPeriodLastDay(period)));
  if (own !== null) barred.add(own);
  return barred;
}

/** The signed-in account's member, `null` for the owner outside the team. */
export async function ownMemberOf(tx: Transaction, userId: string): Promise<TeamMemberId | null> {
  const [own] = await tx
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  return own === undefined ? null : TeamMemberIdSchema.parse(own.id);
}

/**
 * What the validator reads to decide on `period`'s sales: the sales and where the period stands, the signals in force,
 * the day each member left, who a give may not name (`barredOf`) and the reader's own member.
 */
async function decidingOf(tx: Transaction, reads: PayInputReads, period: PayPeriod, userId: string) {
  const read = await periodSalesOf(tx, reads, period);
  const signals: SaleSignals = read.place.closed ? new Map() : await signalsIn(tx, period);
  const members = await reads.members(tx, payPeriodLastDay(period));
  const leftOn = new Map(members.map((member) => [member.id, member.leftOn]));
  const own = await ownMemberOf(tx, userId);
  const barred = await barredOf(tx, reads, period, own);
  return { ...read, signals, leftOn, own, barred };
}

const GiftRowSchema = z.object({
  outcome: z.string(),
  shareBp: z.number().int().nullable(),
  decidedBy: UserIdSchema,
  createdAt: z.date(),
});

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
        const { sales, place, signals, leftOn, barred } = await decidingOf(tx, reads, period, userId);
        return HeldSalesSchema.parse({
          period,
          sales: salesToDecide(sales, place, signals).map((one) => heldSaleOf(one, leftOn, barred)),
        });
      }),

    // The reader's own sales and those no one they may name was on shift for are left out: they give none of them.
    salesToGive: (userId, period, day) =>
      withMember(db, userId, async (tx, scope) => {
        if (scope === 'self') throw new PayrollForbidden();
        const deciding = await decidingOf(tx, reads, period, userId);
        const { sales, place, timeZone, signals, leftOn, barred, own } = deciding;
        return SalesToGiveSchema.parse({
          period,
          day,
          sales: salesToGive(sales, place, day, timeZone, signals)
            .map((one) => heldSaleOf(one, leftOn, barred))
            .filter((one) => one.recipients.length > 0 && (own === null || one.memberId !== own)),
        });
      }),

    // The latest decision of each sale written since the month began, kept when it is a give written that month.
    saleGifts: (userId, period) =>
      withMember(db, userId, async (tx, scope) => {
        if (scope !== 'owner') throw new PayrollForbidden({ ownerOnly: true });
        const timeZone = await reads.agencyTimeZone(tx);
        const month = period.slice(0, 7);
        const monthStart = `${month}-01`;
        const rows = await tx
          .selectDistinctOn([paySaleDecisions.platform, paySaleDecisions.platformSaleId], {
            outcome: paySaleDecisions.outcome,
            shareBp: paySaleDecisions.shareBp,
            decidedBy: paySaleDecisions.decidedBy,
            createdAt: paySaleDecisions.createdAt,
          })
          .from(paySaleDecisions)
          .where(sql`${paySaleDecisions.createdAt} >= (${monthStart}::timestamp at time zone ${timeZone})`)
          .orderBy(
            paySaleDecisions.platform,
            paySaleDecisions.platformSaleId,
            sql`${paySaleDecisions.revision} desc`,
          );
        const counts = new Map<string, { given: number; shared: number }>();
        for (const row of rows) {
          const one = GiftRowSchema.parse(row);
          if (one.outcome !== 'give' || calendarDayAt(one.createdAt, timeZone).slice(0, 7) !== month)
            continue;
          const count = counts.get(one.decidedBy) ?? { given: 0, shared: 0 };
          count.given += 1;
          if (one.shareBp !== null && one.shareBp < SALE_WHOLE_BP) count.shared += 1;
          counts.set(one.decidedBy, count);
        }
        return SaleGiftCountsSchema.parse({
          period,
          monthStart,
          counts: [...counts.entries()]
            .map(([decidedBy, count]) => ({ decidedBy, ...count }))
            .sort((a, b) => b.given - a.given || a.decidedBy.localeCompare(b.decidedBy)),
        });
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
            sent.note === body.note &&
            sent.recipientMemberId === body.recipientMemberId &&
            sent.shareBp === body.shareBp &&
            sent.excludeReason === body.excludeReason;
          if (!same) throw new PayEntryConflict('pay_sale_decision_conflict');
          return { value: decisionOfRow(sent), created: false };
        }

        const { sales, place, creatorOfAccount, creatorIds } = await periodSalesOf(tx, reads, body.period);
        const target = saleToDecide(sales, place, body);
        if (target === null) throw new PaySaleNotFound();
        if (!target.outcomes.includes(body.outcome)) throw new PaySaleOutcomeConflict(target.outcomes);
        const { line } = target;
        const { author } = line;
        const authorMemberId = author.kind === 'member' ? author.memberId : null;
        const own = await ownMemberOf(tx, actor.userId);
        if (own !== null && (own === authorMemberId || own === body.recipientMemberId)) {
          throw new PayrollOwnForbidden();
        }
        if (body.outcome === 'give') {
          const barred = await barredOf(tx, reads, body.period, own);
          const shared = (body.shareBp ?? SALE_WHOLE_BP) < SALE_WHOLE_BP;
          if (
            body.recipientMemberId === null ||
            !target.recipients.includes(body.recipientMemberId) ||
            barred.has(body.recipientMemberId) ||
            (shared && author.kind !== 'member')
          ) {
            throw new PaySaleRecipientConflict();
          }
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
            linkVersion: author.kind === 'member' || author.kind === 'agent' ? author.linkVersion : null,
            recipientMemberId: body.recipientMemberId,
            shareBp: body.shareBp,
            excludeReason: body.excludeReason,
            // A give keeps its sale as the register has it, for its author to read (the trigger checks it).
            ...(body.outcome === 'give' && {
              saleCurrency: line.currency,
              saleNetMinor: line.netMinor,
              saleOccurredAt: line.occurredAt,
            }),
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
          {
            period: body.period,
            outcome: body.outcome,
            revision: row.revision,
            ...(body.outcome === 'give' && {
              recipientMemberId: body.recipientMemberId,
              shareBp: body.shareBp,
            }),
            ...(body.outcome === 'exclude' && { excludeReason: body.excludeReason }),
          },
        );
        await enqueuePayRecalculation(tx, body.period);
        return { value: decisionOfRow(row), created: true };
      }),
  };
}
