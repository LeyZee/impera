import {
  AgentHoursSchema,
  AgentModeSchema,
  CreatorIdSchema,
  TeamMemberIdSchema,
  TeamMemberStatusSchema,
  type CalendarView,
} from '@impera/contracts';
import {
  and,
  enterCreator,
  eq,
  inArray,
  schema,
  sql,
  SNAPSHOT_READ,
  withMember,
  type Database,
} from '@impera/db';
import { z } from 'zod';

import type { CalendarReads, StoredAccount, StoredShift } from '../domain/ports';

import { settingsIn, shiftColumns, StoredAccountSchema, toShift } from './rows';

const { platformAccounts, shifts: shiftTable, teamMembers } = schema;

const ShiftRowSchema = z.object({
  member_id: TeamMemberIdSchema,
  member_name: z.string().min(1),
  member_color: z.string().nullable(),
  creator_id: CreatorIdSchema,
  starts_at: z.coerce.date(),
  ends_at: z.coerce.date(),
});

const AgentRowSchema = z.object({
  creator_id: CreatorIdSchema,
  time_zone: z.string().min(1),
  mode: AgentModeSchema,
  reply: AgentHoursSchema.shape.reply,
});

/**
 * The calendar through `withMember` (CR-12): the shifts and the agent come from `calendar_shifts` and
 * `calendar_agent` (migration 0069), which decide from `app.user_id` what the reader gets; the view only says which
 * of the three answers it is, read from the same transaction (the scope, then the member's own row, which the team's
 * policy lets him read). One snapshot, so that the view, the shifts and the agent agree.
 */
export function createDrizzleCalendarReads(db: Database): CalendarReads {
  return {
    read: (actor, window, creatorIds) =>
      withMember(
        db,
        actor,
        async (tx, scope) => {
          let view: CalendarView = 'agency';
          if (scope === 'self') {
            const [own] = await tx
              .select({ status: teamMembers.status })
              .from(teamMembers)
              .where(eq(teamMembers.userId, actor));
            view =
              own !== undefined && TeamMemberStatusSchema.parse(own.status) === 'active' ? 'team' : 'own';
          }
          const shifts = await tx.execute(
            sql`select * from public.calendar_shifts(${window.from}, ${window.to})`,
          );
          const agents = await tx.execute(sql`select * from public.calendar_agent()`);
          const settings = await settingsIn(tx, window, view === 'agency');
          let agency: { accounts: StoredAccount[]; shifts: StoredShift[]; away: Set<string> } | null = null;
          if (view === 'agency') {
            agency = { accounts: [], shifts: [], away: new Set() };
            for (const creatorId of creatorIds) {
              await enterCreator(tx, creatorId, creatorIds);
              const rows = await tx
                .select(shiftColumns)
                .from(shiftTable)
                .where(
                  and(
                    sql`${shiftTable.cancelledAt} is null`,
                    sql`${shiftTable.startsAt} < ${window.to}`,
                    sql`${shiftTable.endsAt} > ${window.from}`,
                  ),
                );
              agency.shifts.push(...rows.map(toShift));
              const accounts = await tx
                .select({
                  id: platformAccounts.id,
                  creatorId: platformAccounts.creatorId,
                  platform: platformAccounts.platform,
                  handle: platformAccounts.handle,
                })
                .from(platformAccounts);
              agency.accounts.push(...accounts.map((row) => StoredAccountSchema.parse(row)));
            }
            // Who of them is not at work (recette EQP-03): the team's policy lets the agency read every member.
            const named = [...new Set(agency.shifts.map((shift) => shift.memberId))];
            const statuses =
              named.length === 0
                ? []
                : await tx
                    .select({ id: teamMembers.id, status: teamMembers.status })
                    .from(teamMembers)
                    .where(inArray(teamMembers.id, named));
            for (const member of statuses) {
              if (TeamMemberStatusSchema.parse(member.status) !== 'active') agency.away.add(member.id);
            }
          }
          return {
            view,
            settings,
            agency,
            shifts: shifts.rows.map((raw) => {
              const row = ShiftRowSchema.parse(raw);
              return {
                memberId: row.member_id,
                memberName: row.member_name,
                memberColor: row.member_color,
                creatorId: row.creator_id,
                startsAt: row.starts_at,
                endsAt: row.ends_at,
              };
            }),
            agents: agents.rows.map((raw) => {
              const row = AgentRowSchema.parse(raw);
              return { creatorId: row.creator_id, timeZone: row.time_zone, mode: row.mode, reply: row.reply };
            }),
          };
        },
        SNAPSHOT_READ,
      ),
  };
}
