import {
  payRulesFor,
  ShiftIdSchema,
  TeamMemberStatusSchema,
  UserIdSchema,
  type ShiftId,
} from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, type Database } from '@impera/db';

import type { ReportReminderSource } from '../domain/ports';
import { oldestRemindableEnd, REPORT_REMINDER_WINDOWS } from '../domain/report-reminders';
import { shiftPeriod } from '../domain/reports';

import { agencyTimeZone, RulesRowSchema, shiftColumns, toShift } from './rows';

const { accountPayRules, shiftReports, shifts, teamMembers } = schema;

/** The candidates are read a page at a time, each page in its own admin transaction. */
const REMINDER_PAGE = 200;

/** The first window's end, the second's start: a shift that ended between them has no reminder due. */
const quietBetween = {
  from: REPORT_REMINDER_WINDOWS[1].until,
  to: REPORT_REMINDER_WINDOWS[2].after,
} as const;

/**
 * The reads of the reports' reminders (ADR 0077), on the admin connection: a run crosses every creator. They read,
 * never write; `notify` keeps what rang.
 */
export function createDrizzleReportReminderSource(adminDb: Database): ReportReminderSource {
  return {
    candidatesUnscoped: async (now) => {
      const found: ShiftId[] = [];
      let after: { readonly endsAt: Date; readonly id: ShiftId } | null = null;
      const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
      for (;;) {
        const rows = await withAdmin(adminDb, (tx) =>
          tx
            .select({ id: shifts.id, endsAt: shifts.endsAt })
            .from(shifts)
            .where(
              and(
                sql`${shifts.cancelledAt} is null`,
                // Ended within the second window's start and the first window's end, never between the two.
                sql`${shifts.endsAt} > ${oldestRemindableEnd(now)}`,
                sql`${shifts.endsAt} <= ${minutesAgo(REPORT_REMINDER_WINDOWS[1].after)}`,
                sql`not (${shifts.endsAt} <= ${minutesAgo(quietBetween.from)} and ${shifts.endsAt} > ${minutesAgo(quietBetween.to)})`,
                sql`not exists (select 1 from ${shiftReports} r where r.shift_id = ${shifts.id})`,
                after === null
                  ? undefined
                  : sql`(${shifts.endsAt}, ${shifts.id}) > (${after.endsAt}::timestamptz, ${after.id}::uuid)`,
              ),
            )
            .orderBy(shifts.endsAt, shifts.id)
            .limit(REMINDER_PAGE),
        );
        for (const row of rows) found.push(ShiftIdSchema.parse(row.id));
        const last = rows.at(-1);
        if (rows.length < REMINDER_PAGE || last === undefined) return found;
        after = { endsAt: last.endsAt, id: ShiftIdSchema.parse(last.id) };
      }
    },

    factsUnscoped: (shiftId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({
            ...shiftColumns,
            cancelledAt: shifts.cancelledAt,
            userId: teamMembers.userId,
            status: teamMembers.status,
            timeZone: teamMembers.timeZone,
          })
          .from(shifts)
          .innerJoin(teamMembers, eq(teamMembers.id, shifts.memberId))
          .where(eq(shifts.id, shiftId));
        if (row === undefined) return null;
        const shift = toShift(row);
        const [report] = await tx
          .select({ id: shiftReports.id })
          .from(shiftReports)
          .where(eq(shiftReports.shiftId, shiftId))
          .limit(1);
        const rules = await tx
          .select({
            fromPeriod: accountPayRules.fromPeriod,
            currency: accountPayRules.currency,
            earningsSource: accountPayRules.earningsSource,
          })
          .from(accountPayRules)
          .where(eq(accountPayRules.platformAccountId, shift.platformAccountId));
        const period = shiftPeriod(shift.startsAt, await agencyTimeZone(tx));
        const inForce = payRulesFor(
          rules.map((one) => RulesRowSchema.parse(one)),
          period,
        );
        return {
          shift: { id: shift.id, startsAt: shift.startsAt, endsAt: shift.endsAt },
          cancelled: row.cancelledAt !== null,
          reported: report !== undefined,
          earningsSource: inForce?.earningsSource ?? null,
          member: {
            userId: UserIdSchema.parse(row.userId),
            status: TeamMemberStatusSchema.parse(row.status),
            timeZone: row.timeZone,
          },
        };
      }),
  };
}
