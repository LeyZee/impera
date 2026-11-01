import {
  calendarDayAt,
  CommissionStatementStatusSchema,
  payPeriodAt,
  payPeriodLastDay,
  PayPeriodSchema,
  TeamMemberIdSchema,
  type PayPeriod,
  type TeamMemberId,
  type TeamScope,
} from '@nirvana/contracts';
import {
  and,
  eq,
  lockMemberPeriod,
  lockPayrollClose,
  schema,
  sql,
  withMember,
  type Database,
  type Transaction,
} from '@nirvana/db';

import {
  adjustmentPeriod,
  assertJoinedBy,
  assertNotTooFar,
  assertOpenBeforeLocks,
  assertPayment,
  assertWritesPayOf,
  isOpenFor,
  penaltyCancelledFrom,
  periodsChanged,
  periodsToLock,
  type MemberPayFacts,
} from '../domain/entries';
import {
  BonusNotFound,
  CommissionRateMissing,
  CommissionStatementChanged,
  CommissionStatementNotFound,
  CommissionStatementStatusConflict,
  PayEntryConflict,
  PayPeriodClosed,
  PayrollForbidden,
  PenaltyNotFound,
  TeamMemberNotFound,
} from '../domain/errors';
import type { PayReader, PayrollEntryStore } from '../domain/ports';
import type { MemberForPay } from '../domain/recalculation';

import { enqueuePayRecalculation } from './recalculation-queue';
import { adjustmentOfRow, bonusOfRow, closingsSpan, penaltyOfRow, type PayInputReads } from './snapshot';
import { audit } from './writes';

const { bonuses, commissionStatements, payAdjustments, penalties, teamMembers } = schema;

const NOT_PAYABLE = 'Ce relevé n’est pas validé, ou il est déjà payé';

async function readerOf(tx: Transaction, userId: string, scope: TeamScope): Promise<PayReader> {
  const [own] = await tx
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  return { scope, memberId: own === undefined ? null : TeamMemberIdSchema.parse(own.id) };
}

/** The member an entry is for, as pay reads them on `period`'s last day, with the rate in force then. */
async function memberOn(
  tx: Transaction,
  reads: PayInputReads,
  memberId: TeamMemberId,
  period: PayPeriod,
): Promise<MemberForPay> {
  const member = (await reads.members(tx, payPeriodLastDay(period))).find((one) => one.id === memberId);
  if (member === undefined) throw new TeamMemberNotFound();
  return member;
}

/**
 * A member who gets an entry in `period` had joined by then, and has a rate in force there: without one, their
 * statement could not be computed, and the whole period with it. Before they joined, that is what is said.
 */
async function paidMemberOn(
  tx: Transaction,
  reads: PayInputReads,
  memberId: TeamMemberId,
  period: PayPeriod,
): Promise<MemberForPay> {
  const member = await memberOn(tx, reads, memberId, period);
  assertJoinedBy(member.joinedOn, period);
  if (member.rate === null) throw new CommissionRateMissing(memberId);
  return member;
}

/**
 * What decides the member's open periods: read once the write holds its locks, and before them to refuse a period
 * closed already (a closing never moves back, ADR 0035).
 */
async function factsOf(tx: Transaction, member: MemberForPay, current: PayPeriod): Promise<MemberPayFacts> {
  const rows = await tx
    .select({ period: commissionStatements.period, status: commissionStatements.status })
    .from(commissionStatements)
    .where(eq(commissionStatements.memberId, member.id));
  const statements = rows.map((row) => ({
    period: PayPeriodSchema.parse(row.period),
    status: CommissionStatementStatusSchema.parse(row.status),
  }));
  const validated = statements
    .filter((one) => one.status !== 'draft')
    .map((one) => one.period)
    .sort();
  const { first, last } = await closingsSpan(tx);
  const closed = { lastValidated: validated.at(-1) ?? null, firstClosed: first };
  const drafts = statements
    .filter((one) => one.status === 'draft' && isOpenFor(closed, one.period))
    .map((one) => one.period)
    .sort();
  return {
    ...closed,
    lastClosed: last,
    earliestOpenDraft: drafts[0] ?? null,
    joinedOn: member.joinedOn,
    current,
  };
}

/**
 * The locks of a write on the member's pay from `period` on (ADR 0035): `payroll.close` first while no period is
 * closed yet, so that the team's first closing sees the write or the write sees the closing (everything before it is
 * closed for good); then (member, period) for `period` and every later one up to today's, in that order. Returns the
 * locked periods; `held` are those the transaction holds already, all earlier than the new ones.
 */
async function lockFrom(
  tx: Transaction,
  memberId: TeamMemberId,
  period: PayPeriod,
  current: PayPeriod,
  held: readonly PayPeriod[] = [],
): Promise<PayPeriod[]> {
  if (held.length === 0 && (await closingsSpan(tx)).first === null) await lockPayrollClose(tx);
  const locked = [...held];
  for (const one of periodsToLock(period, current)) {
    if (locked.includes(one)) continue;
    await lockMemberPeriod(tx, memberId, one);
    locked.push(one);
  }
  return locked;
}

/**
 * The same `id` was written between the replay's read and the insert, under other locks: the same values give it
 * back, anything else (or a row the writer may not read) is a conflict.
 */
function raced<T>(
  replayed: T | null,
  code: 'bonus_conflict' | 'penalty_conflict' | 'pay_adjustment_conflict',
): T {
  if (replayed === null) throw new PayEntryConflict(code);
  return replayed;
}

async function enqueueChanged(
  tx: Transaction,
  from: PayPeriod,
  to: PayPeriod,
  current: PayPeriod,
): Promise<void> {
  for (const period of periodsChanged(from, to, current)) await enqueuePayRecalculation(tx, period);
}

/**
 * A member's entries and the payment of a statement (EQ-04, ADR 0032), as the member who writes (`withMember`): the
 * policies keep the four eyes and the owner's payment, the triggers keep the periods closed for the member.
 */
export function createDrizzlePayrollEntryStore(
  db: Database,
  reads: PayInputReads,
  now: () => Date,
): PayrollEntryStore {
  const currentIn = async (tx: Transaction): Promise<PayPeriod> =>
    payPeriodAt(now(), await reads.agencyTimeZone(tx));

  return {
    createBonus: (actor, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertWritesPayOf(await readerOf(tx, actor.userId, scope), body.memberId);
        const replay = async () => {
          const [row] = await tx.select().from(bonuses).where(eq(bonuses.id, body.id));
          if (row === undefined) return null;
          const same =
            row.memberId === body.memberId &&
            row.period === body.period &&
            row.amountMinor === body.amountMinor &&
            row.reason === body.reason;
          if (!same) throw new PayEntryConflict('bonus_conflict');
          return { value: bonusOfRow(row), created: false };
        };
        const sent = await replay();
        if (sent !== null) return sent;

        const current = await currentIn(tx);
        assertNotTooFar(body.period, current);
        const member = await paidMemberOn(tx, reads, body.memberId, body.period);
        assertOpenBeforeLocks(await factsOf(tx, member, current), body.period);
        await lockFrom(tx, member.id, body.period, current);
        if (!isOpenFor(await factsOf(tx, member, current), body.period))
          throw new PayPeriodClosed(body.period);
        const [row] = await tx
          .insert(bonuses)
          .values({ ...body, createdBy: actor.userId })
          .onConflictDoNothing({ target: bonuses.id })
          .returning();
        if (row === undefined) return raced(await replay(), 'bonus_conflict');
        await audit(tx, actor, 'bonus.create', { kind: 'bonus', id: row.id }, { period: body.period });
        await enqueueChanged(tx, body.period, body.period, current);
        return { value: bonusOfRow(row), created: true };
      }),

    cancelBonus: (actor, id) =>
      withMember(db, actor.userId, async (tx, scope) => {
        const [found] = await tx.select().from(bonuses).where(eq(bonuses.id, id));
        if (found === undefined) throw new BonusNotFound();
        const memberId = TeamMemberIdSchema.parse(found.memberId);
        assertWritesPayOf(await readerOf(tx, actor.userId, scope), memberId);
        if (found.cancelledAt !== null) return bonusOfRow(found);

        const period = PayPeriodSchema.parse(found.period);
        const member = await memberOn(tx, reads, memberId, period);
        const current = await currentIn(tx);
        assertOpenBeforeLocks(await factsOf(tx, member, current), period);
        await lockFrom(tx, memberId, period, current);
        if (!isOpenFor(await factsOf(tx, member, current), period)) throw new PayPeriodClosed(period);
        const [row] = await tx
          .update(bonuses)
          .set({ cancelledAt: now(), cancelledBy: actor.userId })
          .where(and(eq(bonuses.id, id), sql`${bonuses.cancelledAt} is null`))
          .returning();
        // Cancelled in the meantime by someone else, under the same locks: the same answer.
        if (row === undefined) {
          const [again] = await tx.select().from(bonuses).where(eq(bonuses.id, id));
          if (again === undefined) throw new BonusNotFound();
          return bonusOfRow(again);
        }
        await audit(tx, actor, 'bonus.cancel', { kind: 'bonus', id }, { period });
        await enqueueChanged(tx, period, period, current);
        return bonusOfRow(row);
      }),

    createPenalty: (actor, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertWritesPayOf(await readerOf(tx, actor.userId, scope), body.memberId);
        const fixed = body.amount.kind === 'fixed' ? body.amount.amountMinor : null;
        const bps = body.amount.kind === 'percent' ? body.amount.bps : null;
        const replay = async () => {
          const [row] = await tx.select().from(penalties).where(eq(penalties.id, body.id));
          if (row === undefined) return null;
          const same =
            row.memberId === body.memberId &&
            row.fromPeriod === body.fromPeriod &&
            row.toPeriod === body.toPeriod &&
            row.kind === body.amount.kind &&
            row.amountMinor === fixed &&
            row.bps === bps &&
            row.reason === body.reason;
          if (!same) throw new PayEntryConflict('penalty_conflict');
          return { value: penaltyOfRow(row), created: false };
        };
        const sent = await replay();
        if (sent !== null) return sent;

        const member = await paidMemberOn(tx, reads, body.memberId, body.fromPeriod);
        const current = await currentIn(tx);
        assertOpenBeforeLocks(await factsOf(tx, member, current), body.fromPeriod);
        await lockFrom(tx, member.id, body.fromPeriod, current);
        if (!isOpenFor(await factsOf(tx, member, current), body.fromPeriod)) {
          throw new PayPeriodClosed(body.fromPeriod);
        }
        const [row] = await tx
          .insert(penalties)
          .values({
            id: body.id,
            memberId: body.memberId,
            fromPeriod: body.fromPeriod,
            toPeriod: body.toPeriod,
            kind: body.amount.kind,
            amountMinor: fixed,
            bps,
            reason: body.reason,
            createdBy: actor.userId,
          })
          .onConflictDoNothing({ target: penalties.id })
          .returning();
        if (row === undefined) return raced(await replay(), 'penalty_conflict');
        await audit(
          tx,
          actor,
          'penalty.create',
          { kind: 'penalty', id: row.id },
          { fromPeriod: body.fromPeriod, toPeriod: body.toPeriod },
        );
        await enqueueChanged(tx, body.fromPeriod, body.toPeriod, current);
        return { value: penaltyOfRow(row), created: true };
      }),

    cancelPenalty: (actor, id) =>
      withMember(db, actor.userId, async (tx, scope) => {
        const [found] = await tx.select().from(penalties).where(eq(penalties.id, id));
        if (found === undefined) throw new PenaltyNotFound();
        const penalty = penaltyOfRow(found);
        assertWritesPayOf(await readerOf(tx, actor.userId, scope), penalty.memberId);
        if (penalty.cancellation !== null) return penalty;

        const member = await memberOn(tx, reads, penalty.memberId, penalty.fromPeriod);
        const current = await currentIn(tx);
        // Read before the locks to know which to take, then again under them: a validation that came in between only
        // moves the start later, to periods the transaction holds already or after today's.
        const guessed = penaltyCancelledFrom(penalty, await factsOf(tx, member, current));
        const locked = await lockFrom(tx, member.id, guessed, current);
        const from = penaltyCancelledFrom(penalty, await factsOf(tx, member, current));
        await lockFrom(tx, member.id, from, current, locked);
        const [row] = await tx
          .update(penalties)
          .set({ cancelledAt: now(), cancelledBy: actor.userId, cancelledFrom: from })
          .where(and(eq(penalties.id, id), sql`${penalties.cancelledAt} is null`))
          .returning();
        if (row === undefined) {
          const [again] = await tx.select().from(penalties).where(eq(penalties.id, id));
          if (again === undefined) throw new PenaltyNotFound();
          return penaltyOfRow(again);
        }
        await audit(tx, actor, 'penalty.cancel', { kind: 'penalty', id }, { cancelledFrom: from });
        await enqueueChanged(tx, from, penalty.toPeriod, current);
        return penaltyOfRow(row);
      }),

    createAdjustment: (actor, body) =>
      withMember(db, actor.userId, async (tx, scope) => {
        assertWritesPayOf(await readerOf(tx, actor.userId, scope), body.memberId);
        const replay = async () => {
          const [row] = await tx.select().from(payAdjustments).where(eq(payAdjustments.id, body.id));
          if (row === undefined) return null;
          const same =
            row.memberId === body.memberId &&
            row.amountMinor === body.amountMinor &&
            row.reason === body.reason &&
            row.correctsStatementId === body.correctsStatementId;
          if (!same) throw new PayEntryConflict('pay_adjustment_conflict');
          return { value: adjustmentOfRow(row), created: false };
        };
        const sent = await replay();
        if (sent !== null) return sent;

        if (body.correctsStatementId !== null) {
          const [corrected] = await tx
            .select({ memberId: commissionStatements.memberId, status: commissionStatements.status })
            .from(commissionStatements)
            .where(eq(commissionStatements.id, body.correctsStatementId));
          // Another member's statement is not this one's to correct: as if it did not exist.
          if (corrected === undefined) throw new CommissionStatementNotFound();
          if (corrected.memberId !== body.memberId) throw new CommissionStatementNotFound();
          if (corrected.status === 'draft') {
            throw new CommissionStatementStatusConflict('Un ajustement corrige un relevé validé ou payé');
          }
        }
        const current = await currentIn(tx);
        const known = await memberOn(tx, reads, body.memberId, current);
        // The period is chosen before the locks, then checked under them: a validation that came in between closes it
        // for the member and moves the choice later, to periods the transaction holds already or after today's.
        const guessed = adjustmentPeriod(await factsOf(tx, known, current));
        const locked = await lockFrom(tx, known.id, guessed, current);
        const facts = await factsOf(tx, known, current);
        const period = isOpenFor(facts, guessed) ? guessed : adjustmentPeriod(facts);
        await lockFrom(tx, known.id, period, current, locked);
        await paidMemberOn(tx, reads, known.id, period);
        const [row] = await tx
          .insert(payAdjustments)
          .values({ ...body, period, createdBy: actor.userId })
          .onConflictDoNothing({ target: payAdjustments.id })
          .returning();
        if (row === undefined) return raced(await replay(), 'pay_adjustment_conflict');
        await audit(tx, actor, 'pay_adjustment.create', { kind: 'pay_adjustment', id: row.id }, { period });
        await enqueueChanged(tx, period, period, current);
        return { value: adjustmentOfRow(row), created: true };
      }),

    pay: (actor, statementId, payment) =>
      withMember(db, actor.userId, async (tx, scope) => {
        const { revision } = payment;
        const [row] = await tx
          .select({
            period: commissionStatements.period,
            status: commissionStatements.status,
            revision: commissionStatements.revision,
            payableMinor: commissionStatements.payableMinor,
          })
          .from(commissionStatements)
          .where(eq(commissionStatements.id, statementId));
        if (row === undefined) throw new CommissionStatementNotFound();
        const period = PayPeriodSchema.parse(row.period);
        if (scope !== 'owner') throw new PayrollForbidden({ ownerOnly: true });
        if (row.status !== 'validated') throw new CommissionStatementStatusConflict(NOT_PAYABLE);
        if (row.revision !== revision) throw new CommissionStatementChanged(period);
        assertPayment(
          payment,
          { period, payableMinor: row.payableMinor },
          calendarDayAt(now(), await reads.agencyTimeZone(tx)),
        );
        const paid = await tx
          .update(commissionStatements)
          .set({
            status: 'paid',
            paidAt: now(),
            paidBy: actor.userId,
            paidOn: payment.paidOn,
            paymentMethod: payment.method,
            paymentReference: payment.reference ?? null,
            sentMinor: payment.sentMinor,
          })
          .where(
            and(
              eq(commissionStatements.id, statementId),
              eq(commissionStatements.status, 'validated'),
              eq(commissionStatements.revision, revision),
            ),
          )
          .returning({ id: commissionStatements.id });
        // Paid in the meantime: once only.
        if (paid.length !== 1) throw new CommissionStatementStatusConflict(NOT_PAYABLE);
        await audit(
          tx,
          actor,
          'commission_statement.pay',
          { kind: 'commission_statement', id: statementId },
          { period, revision, paidOn: payment.paidOn, method: payment.method, sentMinor: payment.sentMinor },
        );
        return { period };
      }),
  };
}
