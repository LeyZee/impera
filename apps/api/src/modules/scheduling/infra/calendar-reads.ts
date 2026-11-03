import {
  AgentHoursSchema,
  AgentModeSchema,
  CreatorIdSchema,
  TeamMemberIdSchema,
  TeamMemberStatusSchema,
  type CalendarView,
} from '@nirvana/contracts';
import { eq, schema, sql, SNAPSHOT_READ, withMember, type Database } from '@nirvana/db';
import { z } from 'zod';

import type { CalendarReads } from '../domain/ports';

const { teamMembers } = schema;

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
    read: (actor, window) =>
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
          return {
            view,
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
