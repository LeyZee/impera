import {
  CreatorIdSchema,
  CurrencySchema,
  SHIFT_REPORT_OPENS_BEFORE_END_MINUTES,
  EarningsSourceSchema,
  nextPayPeriod,
  PayPeriodSchema,
  payRulesFor,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  ShiftReportIdSchema,
  ShiftReportStatusSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type PayPeriod,
  type ShiftReportId,
  type TeamScope,
} from '@nirvana/contracts';
import {
  and,
  enterCreator,
  eq,
  inArray,
  lockMemberPeriod,
  schema,
  sql,
  SNAPSHOT_READ,
  withMember,
  withTenantMember,
  type Database,
  type Transaction,
} from '@nirvana/db';
import { z } from 'zod';

import {
  PlatformAccountNotFound,
  ShiftNotFound,
  ShiftReportChanged,
  ShiftReportConflict,
  ShiftReportExists,
  ShiftReportForbidden,
  ShiftReportInvalid,
  ShiftReportNotFound,
  ShiftReportValidated,
} from '../domain/errors';
import type { ShiftReportStore, StoredAccount, StoredShift, StoredShiftReport } from '../domain/ports';
import {
  assertChanges,
  assertDeclarable,
  assertReportOpen,
  assertReportValues,
  assertReviews,
  assertTotalHolds,
  isAgency,
  makerOf,
  shiftPeriod,
  type Reader,
  type RulesRow,
} from '../domain/reports';
import { addMinutes, wallClockToInstant } from '../domain/time';

import type { EnqueuePayRecalculation } from './pay-reads';
import {
  agencyTimeZone,
  audit,
  creatorOfUnscoped,
  memberColumns,
  ownMemberId,
  pgErrorOf,
  shiftColumns,
  StoredAccountSchema,
  toMember,
  toShift,
} from './rows';

const { accountPayRules, platformAccounts, shiftReports, shifts, teamMembers } = schema;

const reportColumns = {
  id: shiftReports.id,
  shiftId: shiftReports.shiftId,
  creatorId: shiftReports.creatorId,
  platformAccountId: shiftReports.platformAccountId,
  memberId: shiftReports.memberId,
  period: shiftReports.period,
  correctsId: shiftReports.correctsId,
  amountMinor: shiftReports.amountMinor,
  currency: shiftReports.currency,
  comment: shiftReports.comment,
  incident: shiftReports.incident,
  status: shiftReports.status,
  version: shiftReports.version,
  byAgency: shiftReports.byAgency,
  submittedBy: shiftReports.submittedBy,
  submittedAt: shiftReports.submittedAt,
  reviewedAt: shiftReports.reviewedAt,
  reviewNote: shiftReports.reviewNote,
  createdAt: shiftReports.createdAt,
};

const StoredShiftReportSchema = z.object({
  id: ShiftReportIdSchema,
  shiftId: ShiftIdSchema,
  creatorId: CreatorIdSchema,
  platformAccountId: PlatformAccountIdSchema,
  memberId: TeamMemberIdSchema,
  period: PayPeriodSchema,
  correctsId: ShiftReportIdSchema.nullable(),
  amountMinor: z.number().int(),
  currency: CurrencySchema,
  comment: z.string().nullable(),
  incident: z.string().nullable(),
  status: ShiftReportStatusSchema,
  version: z.number().int(),
  byAgency: z.boolean(),
  submittedBy: UserIdSchema,
  submittedAt: z.date(),
  reviewedAt: z.date().nullable(),
  reviewNote: z.string().nullable(),
  createdAt: z.date(),
});

const toReport = (row: unknown): StoredShiftReport => StoredShiftReportSchema.parse(row);

const RulesRowSchema = z.object({
  fromPeriod: PayPeriodSchema,
  currency: CurrencySchema,
  earningsSource: EarningsSourceSchema,
});

const accountColumns = {
  id: platformAccounts.id,
  creatorId: platformAccounts.creatorId,
  platform: platformAccounts.platform,
  handle: platformAccounts.handle,
};

const byCreation = (a: StoredShiftReport, b: StoredShiftReport): number =>
  a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

/** The report as the policies show it, locked when it is about to change. */
async function readReport(
  tx: Transaction,
  id: string,
  lock: 'for update' | null = null,
): Promise<StoredShiftReport | null> {
  const query = tx.select(reportColumns).from(shiftReports).where(eq(shiftReports.id, id));
  const [row] = lock === null ? await query : await query.for('update');
  return row === undefined ? null : toReport(row);
}

/** The shift's report and its corrections, oldest first. */
async function reportsOfShift(tx: Transaction, shiftId: string): Promise<StoredShiftReport[]> {
  const rows = await tx.select(reportColumns).from(shiftReports).where(eq(shiftReports.shiftId, shiftId));
  return rows.map(toReport).toSorted(byCreation);
}

/** A shift as the policies show it, cancelled ones read too; `null` when hidden. */
async function shiftOf(tx: Transaction, id: string): Promise<(StoredShift & { cancelled: boolean }) | null> {
  const [row] = await tx
    .select({ ...shiftColumns, cancelledAt: shifts.cancelledAt })
    .from(shifts)
    .where(eq(shifts.id, id));
  return row === undefined ? null : { ...toShift(row), cancelled: row.cancelledAt !== null };
}

const SHIFT_MOVED = 'Ce shift a changé pendant l’envoi : relis-le avant de faire son rapport';

/**
 * The shift read again, as its report was decided on: cancelled, it is no longer found; with another member or another
 * start, the report would be under a lock, or in a period, that are not its own.
 */
async function shiftAsSeen(tx: Transaction, seen: StoredShift): Promise<StoredShift> {
  const shift = await shiftOf(tx, seen.id);
  if (shift === null || shift.cancelled) throw new ShiftNotFound();
  if (shift.memberId !== seen.memberId || shift.startsAt.getTime() !== seen.startsAt.getTime()) {
    throw new ShiftReportChanged(SHIFT_MOVED);
  }
  return shift;
}

/** The account's pay rules, every period. */
async function rulesOf(tx: Transaction, platformAccountId: string): Promise<RulesRow[]> {
  const rows = await tx
    .select({
      fromPeriod: accountPayRules.fromPeriod,
      currency: accountPayRules.currency,
      earningsSource: accountPayRules.earningsSource,
    })
    .from(accountPayRules)
    .where(eq(accountPayRules.platformAccountId, platformAccountId));
  return rows.map((row) => RulesRowSchema.parse(row));
}

const readerIn = async (tx: Transaction, userId: string, scope: TeamScope): Promise<Reader> => ({
  userId,
  scope,
  memberId: await ownMemberId(tx, userId),
});

/** The instants a period covers in the agency's zone: from its first midnight to the next period's. */
function periodSpan(period: PayPeriod, timeZone: string): { from: Date; to: Date } {
  return {
    from: wallClockToInstant(period, 0, timeZone),
    to: wallClockToInstant(nextPayPeriod(period), 0, timeZone),
  };
}

/**
 * The end-of-shift reports through `withTenantMember` in the shift's creator (EQ-03): the policies decide who reads
 * and writes each row, the module's rules run in the same transaction, and every write takes the lock (member,
 * period) of ADR 0023 § Paie before it locks any row, the lock pay's validation takes too.
 */
export function createDrizzleShiftReportStore(
  db: Database,
  adminDb: Database,
  enqueuePayRecalculation: EnqueuePayRecalculation,
): ShiftReportStore {
  /** In the creator of report `id`, as `userId`; `shift_report_not_found` when no such report exists. */
  async function inReportCreator<T>(
    id: ShiftReportId,
    userId: string,
    fn: (tx: Transaction, reader: Reader) => Promise<T>,
  ): Promise<T> {
    const creatorId = await creatorOfUnscoped(adminDb, shiftReports, id);
    if (creatorId === null) throw new ShiftReportNotFound();
    return withTenantMember(db, creatorId, userId, async (tx, scope) =>
      fn(tx, await readerIn(tx, userId, scope)),
    );
  }

  async function reportAfterWrite(tx: Transaction, id: string): Promise<StoredShiftReport> {
    const report = await readReport(tx, id);
    if (report === null) throw new ShiftReportNotFound();
    return report;
  }

  return {
    context: async (actor, shiftId) => {
      const creatorId = await creatorOfUnscoped(adminDb, shifts, shiftId);
      if (creatorId === null) throw new ShiftNotFound();
      return withTenantMember(db, creatorId, actor, async (tx, scope) => {
        const reader = await readerIn(tx, actor, scope);
        const shift = await shiftOf(tx, shiftId);
        if (shift === null || shift.cancelled) throw new ShiftNotFound();
        // A colleague asked in a swap reads the shift offered, never its report.
        if (!isAgency(reader) && shift.memberId !== reader.memberId) throw new ShiftReportForbidden();
        const [account] = await tx
          .select(accountColumns)
          .from(platformAccounts)
          .where(eq(platformAccounts.id, shift.platformAccountId));
        if (account === undefined) throw new PlatformAccountNotFound();
        const reports = await reportsOfShift(tx, shiftId);
        // The report keeps the period it was made in; before it, the shift's in the agency's zone now.
        const period =
          reports.find((one) => one.correctsId === null)?.period ??
          shiftPeriod(shift.startsAt, await agencyTimeZone(tx));
        return {
          shift,
          account: StoredAccountSchema.parse(account),
          period,
          rules: payRulesFor(await rulesOf(tx, shift.platformAccountId), period),
          reports,
          reader,
        };
      });
    },

    create: async (actor, report, now) => {
      const creatorId = await creatorOfUnscoped(adminDb, shifts, report.shiftId);
      if (creatorId === null) throw new ShiftNotFound();
      return withTenantMember(db, creatorId, actor.userId, async (tx, scope) => {
        const reader = await readerIn(tx, actor.userId, scope);
        /** The same report sent again is given back; the same id with other values is refused. */
        const replay = async (): Promise<{
          report: StoredShiftReport;
          created: false;
          reader: Reader;
        } | null> => {
          const [existing] = await tx
            .select({ ...reportColumns, createdBy: shiftReports.createdBy })
            .from(shiftReports)
            .where(eq(shiftReports.id, report.id));
          if (existing === undefined) return null;
          const same =
            existing.createdBy === actor.userId &&
            existing.shiftId === report.shiftId &&
            existing.correctsId === report.correctsId &&
            existing.amountMinor === report.amountMinor &&
            existing.currency === report.currency &&
            existing.comment === report.comment &&
            existing.incident === report.incident;
          if (!same) throw new ShiftReportConflict();
          return { report: toReport(existing), created: false, reader };
        };
        const sent = await replay();
        if (sent !== null) return sent;

        const seen = await shiftOf(tx, report.shiftId);
        if (seen === null || seen.cancelled) throw new ShiftNotFound();
        const correcting = report.correctsId !== null;
        const { byAgency } = makerOf(seen.memberId, correcting, reader);
        assertReportValues(report);
        const corrected = report.correctsId === null ? null : await readReport(tx, report.correctsId);
        if (correcting && corrected?.shiftId !== seen.id) throw new ShiftReportNotFound();
        // A correction keeps the period of the report it corrects; a report takes its shift's, frozen now.
        const period = corrected?.period ?? shiftPeriod(seen.startsAt, await agencyTimeZone(tx));
        await lockMemberPeriod(tx, seen.memberId, period);

        // Under the lock, read again what was read before it: the same request sent twice at once (a double click, a
        // network retry) waited here behind its twin and is a replay; a shift given to another member meanwhile would
        // put this report under a lock that is not its member's.
        const twin = await replay();
        if (twin !== null) return twin;
        const shift = await shiftAsSeen(tx, seen);

        const shiftReportsNow = await reportsOfShift(tx, shift.id);
        if (corrected === null) {
          assertReportOpen(shift, now);
          const made = shiftReportsNow.find((one) => one.correctsId === null);
          if (made !== undefined) throw new ShiftReportExists(made.id);
        } else {
          const target = shiftReportsNow.find((one) => one.id === corrected.id) ?? corrected;
          if (target.correctsId !== null) {
            throw new ShiftReportInvalid(
              'Une correction corrige le rapport du shift, pas une autre correction',
            );
          }
          if (target.status !== 'validated') {
            throw new ShiftReportValidated(
              'Seul un rapport validé se corrige : change-le tant qu’il ne l’est pas',
            );
          }
          assertTotalHolds(shiftReportsNow, {
            id: report.id,
            status: 'submitted',
            amountMinor: report.amountMinor,
          });
        }
        assertDeclarable(await rulesOf(tx, shift.platformAccountId), period, report.currency);

        try {
          await tx.transaction((savepoint) =>
            savepoint.insert(shiftReports).values({
              ...report,
              creatorId: shift.creatorId,
              platformAccountId: shift.platformAccountId,
              memberId: shift.memberId,
              period,
              status: 'submitted',
              version: 1,
              byAgency,
              submittedBy: actor.userId,
              submittedAt: now,
              createdBy: actor.userId,
            }),
          );
        } catch (error) {
          const failure = pgErrorOf(error);
          // A swap gave the shift to another member after the read under the lock: the foreign key no longer holds.
          if (failure?.code === '23503' && failure.constraint === 'shift_reports_shift_fk') {
            throw new ShiftReportChanged(SHIFT_MOVED);
          }
          if (failure?.code !== '23505') throw error;
          if (failure.constraint === 'shift_reports_shift_unique') {
            const raced = (await reportsOfShift(tx, shift.id)).find((one) => one.correctsId === null);
            throw new ShiftReportExists(raced?.id ?? report.id);
          }
          // The same id is a report this account does not see, or was recorded in the meantime.
          throw new ShiftReportConflict();
        }
        // A cancellation or a move that held the shift's row (`for update`) made the insert wait on it, through its
        // foreign key: read the shift again now that it is written, and keep the report only on the shift it was made on.
        await shiftAsSeen(tx, shift);
        await audit(
          tx,
          actor,
          correcting ? 'shift_report.correct' : 'shift_report.create',
          { kind: 'shift_report', id: report.id },
          { period, byAgency },
        );
        return { report: await reportAfterWrite(tx, report.id), created: true, reader };
      });
    },

    update: (actor, id, version, change, now) =>
      inReportCreator(id, actor.userId, async (tx, reader) => {
        const seen = await readReport(tx, id);
        if (seen === null) throw new ShiftReportNotFound();
        await lockMemberPeriod(tx, seen.memberId, seen.period);
        const report = await readReport(tx, id, 'for update');
        if (report === null) {
          // `for update` reads only what the policies let this reader update: say why from what they read.
          assertChanges(seen, version, reader);
          throw new ShiftReportChanged();
        }
        assertChanges(report, version, reader);
        const next = {
          amountMinor: change.amountMinor ?? report.amountMinor,
          comment: change.comment === undefined ? report.comment : change.comment,
          incident: change.incident === undefined ? report.incident : change.incident,
        };
        assertReportValues({ correctsId: report.correctsId, ...next });
        const unchanged =
          next.amountMinor === report.amountMinor &&
          next.comment === report.comment &&
          next.incident === report.incident;
        // A submitted report sent again as it is: nothing to write, the version stays.
        if (unchanged && report.status === 'submitted') return { report, reader };
        assertDeclarable(await rulesOf(tx, report.platformAccountId), report.period, report.currency);
        if (report.correctsId !== null) {
          assertTotalHolds(await reportsOfShift(tx, report.shiftId), { ...report, ...next });
        }
        await tx
          .update(shiftReports)
          .set({
            ...next,
            status: 'submitted',
            version: report.version + 1,
            submittedBy: actor.userId,
            submittedAt: now,
            reviewedBy: null,
            reviewedAt: null,
            reviewNote: null,
            updatedAt: now,
          })
          .where(eq(shiftReports.id, id));
        await audit(
          tx,
          actor,
          report.status === 'rejected' ? 'shift_report.resubmit' : 'shift_report.update',
          { kind: 'shift_report', id },
          { version: report.version + 1 },
        );
        return { report: await reportAfterWrite(tx, id), reader };
      }),

    review: (actor, id, version, review, now) =>
      inReportCreator(id, actor.userId, async (tx, reader) => {
        const seen = await readReport(tx, id);
        if (seen === null) throw new ShiftReportNotFound();
        await lockMemberPeriod(tx, seen.memberId, seen.period);
        const report = await readReport(tx, id, 'for update');
        if (report === null) {
          assertReviews(seen, version, reader);
          throw new ShiftReportChanged();
        }
        assertReviews(report, version, reader);
        const validating = review.decision === 'validate';
        if (validating) {
          // Pay reads it from now on: the rules it was made under, and the shift's total with it, once more.
          assertDeclarable(await rulesOf(tx, report.platformAccountId), report.period, report.currency);
          assertTotalHolds(await reportsOfShift(tx, report.shiftId), report);
        }
        await tx
          .update(shiftReports)
          .set({
            status: validating ? 'validated' : 'rejected',
            version: report.version + 1,
            reviewedBy: actor.userId,
            reviewedAt: now,
            reviewNote: validating ? null : review.note,
            updatedAt: now,
          })
          .where(eq(shiftReports.id, id));
        // Pay counts it from now on: its period's drafts, or the team's first open period's (EQ-04, ADR 0032).
        if (validating) await enqueuePayRecalculation(tx, report.period);
        await audit(
          tx,
          actor,
          validating ? 'shift_report.validate' : 'shift_report.reject',
          { kind: 'shift_report', id },
          { version: report.version + 1 },
        );
        return { report: await reportAfterWrite(tx, id), reader };
      }),

    list: (actor, creatorIds, period, now) =>
      withMember(
        db,
        actor,
        async (tx, scope) => {
          const reader = await readerIn(tx, actor, scope);
          // Anyone else than the agency reads their own: a colleague's shift a swap shows is never a line here.
          const own = isAgency(reader) ? null : reader.memberId;
          if (!isAgency(reader) && own === null) {
            return { reports: [], shifts: [], accounts: [], members: [], reader };
          }
          const span = period === null ? null : periodSpan(period, await agencyTimeZone(tx));
          const reports: StoredShiftReport[] = [];
          const shiftRows: StoredShift[] = [];
          const accounts: StoredAccount[] = [];
          for (const creatorId of creatorIds) {
            await enterCreator(tx, creatorId, creatorIds);
            const rows = (
              await tx
                .select(reportColumns)
                .from(shiftReports)
                .where(
                  and(
                    period === null
                      ? inArray(shiftReports.status, ['submitted', 'rejected'])
                      : eq(shiftReports.period, period),
                    own === null ? undefined : eq(shiftReports.memberId, own),
                  ),
                )
            ).map(toReport);
            const named = [...new Set(rows.map((one) => one.shiftId))];
            const which = named.length === 0 ? [] : [inArray(shifts.id, named)];
            if (span !== null) {
              // The period's shifts that take a report already (`reportOpensAt`): started, and near their end or past.
              which.push(
                sql`(${shifts.cancelledAt} is null and ${shifts.startsAt} >= ${span.from} and ${shifts.startsAt} < ${span.to} and ${shifts.startsAt} <= ${now} and ${shifts.endsAt} <= ${addMinutes(now, SHIFT_REPORT_OPENS_BEFORE_END_MINUTES)})`,
              );
            }
            const found =
              which.length === 0
                ? []
                : await tx
                    .select(shiftColumns)
                    .from(shifts)
                    .where(
                      and(
                        sql`(${sql.join(which, sql` or `)})`,
                        own === null ? undefined : eq(shifts.memberId, own),
                      ),
                    );
            const creatorShifts = found.map(toShift);
            const accountIds = [...new Set(creatorShifts.map((one) => one.platformAccountId))];
            const creatorAccounts =
              accountIds.length === 0
                ? []
                : await tx
                    .select(accountColumns)
                    .from(platformAccounts)
                    .where(inArray(platformAccounts.id, accountIds));
            reports.push(...rows);
            shiftRows.push(...creatorShifts);
            accounts.push(...creatorAccounts.map((row) => StoredAccountSchema.parse(row)));
          }
          const memberIds = [
            ...new Set([...reports.map((one) => one.memberId), ...shiftRows.map((one) => one.memberId)]),
          ];
          const members =
            memberIds.length === 0
              ? []
              : await tx.select(memberColumns).from(teamMembers).where(inArray(teamMembers.id, memberIds));
          return {
            reports: reports.toSorted(byCreation),
            shifts: shiftRows.toSorted(
              (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id),
            ),
            accounts,
            members: members.map(toMember),
            reader,
          };
        },
        SNAPSHOT_READ,
      ),

    reader: (actor) => withMember(db, actor, (tx, scope) => readerIn(tx, actor, scope)),
  };
}
