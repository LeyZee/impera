import {
  canonicalExchangeRates,
  CarryOverIdSchema,
  carryOverRank,
  CommissionStatementStatusSchema,
  newId,
  nextPayPeriod,
  PayPeriodSchema,
  ShiftReportIdSchema,
  TeamMemberIdSchema,
  type PayPeriod,
  type ShiftReportId,
  type TeamMemberId,
} from '@nirvana/contracts';
import {
  and,
  enterCreator,
  eq,
  lockMemberPeriod,
  lockPayrollClose,
  schema,
  sql,
  withAdmin,
  withMember,
  type Database,
  type Transaction,
} from '@nirvana/db';
import { z } from 'zod';

import {
  CommissionStatementChanged,
  CommissionStatementNotFound,
  CommissionStatementOrder,
  PayPeriodNotComputed,
  PayPeriodOrder,
  PayPeriodReportsPending,
  PayPeriodReportsUnread,
} from '../domain/errors';
import type { Actor, PayrollValidationStore } from '../domain/ports';
import {
  closePeriod,
  paysMember,
  periodIsEmpty,
  statementOf,
  type ClosingPlan,
  type PeriodSnapshot,
  type ReportForPay,
} from '../domain/recalculation';
import {
  assertValidates,
  periodBeforeFirstClosing,
  periodsOwedBefore,
  type StatementHead,
} from '../domain/validation';

import { enqueueInvoiceIssue } from './invoice-queue';
import { enqueuePayRecalculation } from './recalculation-queue';
import { closingsSpan, readSnapshot, registeredAmong, type PayInputReads } from './snapshot';
import { audit } from './writes';

const { carryOvers, commissionStatements, payPeriodClosings, payPeriodReports, payPeriods, teamMembers } =
  schema;

/** The validated reports no closing counted yet, on every creator: a read bounded to the closing's check. */
function waitingReportsUnscoped(
  adminDb: Database,
  reads: PayInputReads,
  upTo: PayPeriod,
): Promise<ShiftReportId[]> {
  return withAdmin(adminDb, async (tx) => {
    const reports = await reads.validatedReportsUnscoped(tx, upTo);
    const registered = await registeredAmong(
      tx,
      reports.map((report) => report.id),
    );
    return reports.filter((report) => !registered.has(report.id)).map((report) => report.id);
  });
}

/** Before the team's first closing, the earliest period that has a statement or an entry before `period`. */
async function earliestEntriesBefore(tx: Transaction, period: PayPeriod): Promise<PayPeriod | null> {
  const result = await tx.execute(sql`
    select least(
      (select min(period) from commission_statements where period < ${period}::date),
      (select min(period) from bonuses where period < ${period}::date and cancelled_at is null),
      (select min(period) from pay_adjustments where period < ${period}::date),
      (select min(from_period) from penalties
        where from_period < ${period}::date and (cancelled_from is null or cancelled_from > from_period))
    )::text as first`);
  const first = z.object({ first: z.string().nullable() }).parse(result.rows[0]).first;
  return first === null ? null : PayPeriodSchema.parse(first);
}

/**
 * Writes `period`'s closing and its registry (ADR 0032). Each report is registered in its own creator: the registry's
 * trigger reads it under the writer's policies. The rates go in their one order (`canonicalExchangeRates`).
 */
async function writeClosing(
  tx: Transaction,
  actor: Actor,
  period: PayPeriod,
  closing: ClosingPlan,
  creatorOf: ReadonlyMap<ShiftReportId, string>,
  creatorIds: readonly string[],
): Promise<void> {
  const [window] = await tx
    .select({ period: payPeriods.period })
    .from(payPeriods)
    .where(eq(payPeriods.period, period));
  // The hourly job writes every open period's window: one missing means it has not run since the period began.
  if (window === undefined) throw new PayPeriodNotComputed(period);
  await tx.insert(payPeriodClosings).values({
    period,
    teamNetMinor: closing.teamNetMinor,
    collective: closing.collective,
    exchangeRates: canonicalExchangeRates(closing.exchangeRates),
    closedBy: actor.userId,
  });
  const byCreator = new Map<string, ReportForPay[]>();
  for (const report of closing.counted) {
    const creatorId = creatorOf.get(report.id);
    if (creatorId === undefined) throw new Error(`Report ${report.id} was not read in a creator`);
    byCreator.set(creatorId, [...(byCreator.get(creatorId) ?? []), report]);
  }
  for (const [creatorId, reports] of [...byCreator.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    await enterCreator(tx, creatorId, creatorIds);
    await tx
      .insert(payPeriodReports)
      .values(reports.map((report) => ({ shiftReportId: report.id, period, memberId: report.memberId })));
  }
  await audit(
    tx,
    actor,
    'pay_period.close',
    { kind: 'pay_period', id: period },
    { reports: closing.counted.length },
  );
}

interface ReadReports {
  readonly reports: readonly ReportForPay[];
  readonly creatorOf: ReadonlyMap<ShiftReportId, string>;
}

/** The validated reports up to `upTo`, creator by creator as the member of the transaction reads them. */
async function reportsAsMember(
  tx: Transaction,
  reads: PayInputReads,
  creatorIds: readonly string[],
  upTo: PayPeriod,
): Promise<ReadReports> {
  const byCreator = await reads.validatedReportsScoped(tx, creatorIds, upTo);
  return {
    reports: byCreator.flatMap((one) => one.reports),
    creatorOf: new Map(byCreator.flatMap((one) => one.reports.map((report) => [report.id, one.creatorId]))),
  };
}

const upTo = (reports: readonly ReportForPay[], period: PayPeriod): ReportForPay[] =>
  reports.filter((report) => report.period <= period);

/**
 * The closing of `period` and of the empty periods before it (ADR 0032), in the validation's transaction, under
 * `payroll.close`: nothing waits for review, the member reads every report the closing counts, and the earlier
 * periods are settled. Returns the period's snapshot once closed, and the periods it closed.
 */
async function closeUpTo(
  tx: Transaction,
  adminDb: Database,
  reads: PayInputReads,
  actor: Actor,
  creatorIds: readonly string[],
  period: PayPeriod,
): Promise<{ readonly closed: PeriodSnapshot; readonly reports: readonly ReportForPay[] }> {
  const { last } = await closingsSpan(tx);
  const pending = await reads.reportsAwaitingReviewScoped(tx, creatorIds, last, period);
  if (pending > 0) throw new PayPeriodReportsPending(pending);
  // Read first on the admin connection: the member's read, after it, sees every one of them and maybe newer ones.
  const waiting = await waitingReportsUnscoped(adminDb, reads, period);
  const { reports, creatorOf } = await reportsAsMember(tx, reads, creatorIds, period);
  const unread = waiting.filter((id) => !creatorOf.has(id)).length;
  if (unread > 0) throw new PayPeriodReportsUnread(unread);

  if (last === null) {
    const blocking = periodBeforeFirstClosing(period, [
      await earliestEntriesBefore(tx, period),
      ...reports.map((report) => report.period),
    ]);
    if (blocking !== null) throw new PayPeriodOrder(blocking);
  } else {
    for (let between = nextPayPeriod(last); between < period; between = nextPayPeriod(between)) {
      const snapshot = await readSnapshot(tx, reads, between, upTo(reports, between));
      if (!periodIsEmpty(snapshot)) throw new PayPeriodOrder(between);
      await writeClosing(tx, actor, between, closePeriod(snapshot).closing, creatorOf, creatorIds);
    }
  }
  const { closing, closed } = closePeriod(await readSnapshot(tx, reads, period, reports));
  await writeClosing(tx, actor, period, closing, creatorOf, creatorIds);
  return { closed, reports };
}

/**
 * The member's earlier closed periods where pay owes them a statement it has not written yet: the validation waits
 * for it (`commission_statement_order_conflict` with the period), or that statement could never be written.
 */
async function assertNothingOwedBefore(
  tx: Transaction,
  reads: PayInputReads,
  snapshot: PeriodSnapshot,
  reports: readonly ReportForPay[],
  memberId: TeamMemberId,
): Promise<void> {
  const member = snapshot.members.find((one) => one.id === memberId);
  if (member === undefined || snapshot.firstClosed === null)
    throw new Error('A validation outside its closing');
  const rows = await tx
    .select({ period: commissionStatements.period, status: commissionStatements.status })
    .from(commissionStatements)
    .where(
      and(
        eq(commissionStatements.memberId, memberId),
        sql`${commissionStatements.period} < ${snapshot.period}`,
      ),
    );
  const written = new Set(rows.map((row) => PayPeriodSchema.parse(row.period)));
  const validated = rows
    .filter((row) => CommissionStatementStatusSchema.parse(row.status) !== 'draft')
    .map((row) => PayPeriodSchema.parse(row.period))
    .sort();
  const owed = periodsOwedBefore(snapshot.period, {
    firstClosed: snapshot.firstClosed,
    lastValidated: validated.at(-1) ?? null,
    joinedOn: member.joinedOn,
  }).filter((period) => !written.has(period));
  for (const period of owed) {
    if (paysMember(await readSnapshot(tx, reads, period, upTo(reports, period)), memberId)) {
      throw new CommissionStatementOrder({ period });
    }
  }
}

/**
 * The validation of a statement (EQ-04, ADR 0032), as the member who validates (`withMember`, the policies keep the four
 * eyes), in one transaction: `payroll.close`, then the lock (member, period) of EQ-03, the period's closing when it is
 * open, the statement computed again on the closing and compared with the revision shown, the status, the carry-over.
 */
export function createDrizzlePayrollValidationStore(
  db: Database,
  adminDb: Database,
  reads: PayInputReads,
  now: () => Date,
): PayrollValidationStore {
  return {
    validate: (actor, statementId, revision) =>
      withMember(db, actor.userId, async (tx, scope) => {
        await lockPayrollClose(tx);
        const [own] = await tx
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(eq(teamMembers.userId, actor.userId));
        const [row] = await tx
          .select({
            memberId: commissionStatements.memberId,
            period: commissionStatements.period,
            status: commissionStatements.status,
            revision: commissionStatements.revision,
            inputsHash: commissionStatements.inputsHash,
            endsAt: payPeriods.endsAt,
          })
          .from(commissionStatements)
          .innerJoin(payPeriods, eq(payPeriods.period, commissionStatements.period))
          .where(eq(commissionStatements.id, statementId));
        if (row === undefined) throw new CommissionStatementNotFound();
        const head: StatementHead = {
          memberId: TeamMemberIdSchema.parse(row.memberId),
          period: PayPeriodSchema.parse(row.period),
          status: CommissionStatementStatusSchema.parse(row.status),
          revision: row.revision,
          inputsHash: row.inputsHash,
        };
        const reader = { scope, memberId: own === undefined ? null : TeamMemberIdSchema.parse(own.id) };
        assertValidates(head, reader, revision, row.endsAt, now());
        const [earlier] = await tx
          .select({ id: commissionStatements.id })
          .from(commissionStatements)
          .where(
            and(
              eq(commissionStatements.memberId, head.memberId),
              eq(commissionStatements.status, 'draft'),
              sql`${commissionStatements.period} < ${head.period}`,
            ),
          )
          .orderBy(commissionStatements.period)
          .limit(1);
        if (earlier !== undefined) throw new CommissionStatementOrder({ statementId: earlier.id });
        await lockMemberPeriod(tx, head.memberId, head.period);

        const creatorIds = await reads.creatorIds();
        const [closingRow] = await tx
          .select({ period: payPeriodClosings.period })
          .from(payPeriodClosings)
          .where(eq(payPeriodClosings.period, head.period));
        let closed: PeriodSnapshot;
        let reports: readonly ReportForPay[];
        if (closingRow === undefined) {
          ({ closed, reports } = await closeUpTo(tx, adminDb, reads, actor, creatorIds, head.period));
        } else {
          const read = await reportsAsMember(tx, reads, creatorIds, head.period);
          const counted = await tx
            .select({ id: payPeriodReports.shiftReportId })
            .from(payPeriodReports)
            .where(eq(payPeriodReports.period, head.period));
          const unread = counted.filter(
            (one) => !read.creatorOf.has(ShiftReportIdSchema.parse(one.id)),
          ).length;
          if (unread > 0) throw new PayPeriodReportsUnread(unread);
          reports = read.reports;
          closed = await readSnapshot(tx, reads, head.period, reports);
        }

        const statement = statementOf(closed, head.memberId);
        if (statement.inputsHash !== head.inputsHash) throw new CommissionStatementChanged(head.period);
        await assertNothingOwedBefore(tx, reads, closed, reports, head.memberId);

        const validated = await tx
          .update(commissionStatements)
          .set({ status: 'validated', validatedAt: now(), validatedBy: actor.userId })
          .where(
            and(
              eq(commissionStatements.id, statementId),
              eq(commissionStatements.status, 'draft'),
              eq(commissionStatements.revision, revision),
            ),
          )
          .returning({ id: commissionStatements.id });
        if (validated.length !== 1) throw new CommissionStatementChanged(head.period);
        const carried = statement.content.carryOverOutMinor;
        if (carried !== 0) {
          await tx.insert(carryOvers).values({
            id: newId(CarryOverIdSchema),
            memberId: head.memberId,
            fromPeriod: head.period,
            toPeriod: nextPayPeriod(head.period),
            amountMinor: carried,
            // How many times in a row its amount has been carried (ADR 0038); the base checks it.
            rank: carryOverRank(statement.content.counted.carryOversIn, carried),
            statementId,
          });
        }
        await audit(
          tx,
          actor,
          'commission_statement.validate',
          { kind: 'commission_statement', id: statementId },
          { period: head.period, revision, carriedMinor: carried },
        );
        // The period's other drafts on its closing, then the team's first open period, where the carry-over and the
        // reports that came late go.
        await enqueuePayRecalculation(tx, head.period);
        // Its invoice and the credit notes its period owes (EQ-06 lot 3), once this validation commits.
        await enqueueInvoiceIssue(tx, statementId);
        return { period: head.period };
      }),

    enqueueRecalculation: (actor, period) =>
      withMember(db, actor.userId, (tx) => enqueuePayRecalculation(tx, period)),
  };
}
