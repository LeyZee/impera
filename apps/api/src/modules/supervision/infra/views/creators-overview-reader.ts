import { agentHoursNow, DropCategorySchema, PlatformSchema } from '@impera/contracts';
import { sql, withTenantMember, type Database } from '@impera/db';
import { z } from 'zod';

import type { CreatorOverviewView } from '../../domain/dashboard-ports';

import { herHours } from './her-hours';

const CreatorSchema = z.object({ timezone: z.string().min(1), agent_hours: z.unknown() });
const SwitchSchema = z.object({
  scope: z.string(),
  active: z.boolean(),
  active_until: z
    .union([z.date(), z.string()])
    .transform((value) => new Date(value))
    .nullable(),
});
const CountSchema = z.object({
  auto: z.coerce.number().int().nonnegative(),
  persona: z.boolean(),
});
const RequestSchema = z.object({ category: DropCategorySchema, due_on: z.string() });
const NameSchema = z.object({ id: z.string(), display_name: z.string() });

/**
 * A creator's card in the list of Créatrices, read as whoever reads the list: inside her tenant and with his team
 * scope, so the policies decide what he sees. Her requests (`content_requests`, `team_read`) and the team's names are
 * the owner's and an active manager's only: a scope of one's own reads neither, and gets her mode alone.
 */
export function createCreatorsOverviewReader(db: Database): CreatorOverviewView {
  return {
    read: (creatorId, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        const creator = await tx.execute(
          sql`select timezone, agent_hours from creators where id = ${creatorId}::uuid and archived_at is null`,
        );
        const [her] = z.array(CreatorSchema).parse(creator.rows);
        if (her === undefined) return undefined;
        const stopped = z.array(SwitchSchema).parse(
          (
            await tx.execute(
              sql`select distinct on (scope) scope, (active and (active_until is null or active_until > now())) as active,
                         active_until from kill_switches
                  where scope = 'global' or (scope = 'creator' and scope_id = ${creatorId}::uuid)
                  order by scope, set_at desc`,
            )
          ).rows,
        );
        const [counts] = z.array(CountSchema).parse(
          (
            await tx.execute(
              sql`select count(*) filter (where mode = 'auto' and state not in ('human', 'paused')) as auto,
                         exists (select 1 from persona_versions where is_active) as persona
                  from conversations`,
            )
          ).rows,
        );
        const expired = z.array(z.object({ platform: PlatformSchema })).parse(
          (
            await tx.execute(
              sql`select distinct platform from platform_accounts
                    where creator_id = ${creatorId}::uuid and session_state = 'expired'`,
            )
          ).rows,
        );
        const expiredSessions = expired.map((row) => row.platform);
        const switches = {
          global: stopped.some((s) => s.scope === 'global' && s.active),
          creator: stopped.some((s) => s.scope === 'creator' && s.active),
        };
        // Her pause and her hours now, as her switch says them (ADR 0148 § 1).
        const pausedUntil = stopped.find((s) => s.scope === 'creator' && s.active)?.active_until ?? null;
        const hours = await herHours(tx, creatorId, her.timezone, her.agent_hours);
        const hoursNow = agentHoursNow(hours.hours, hours.timeZone, new Date(), hours.exceptions);
        if (scope === 'self') {
          return {
            timezone: her.timezone,
            scope,
            switches,
            pausedUntil,
            hoursNow,
            autoConversations: counts?.auto ?? 0,
            hasActivePersona: counts?.persona ?? false,
            expiredSessions,
            requests: [],
            names: new Map(),
          };
        }
        // Open, and answered by no drop not withdrawn: what she still owes (ADR 0055 § 4).
        const requests = z.array(RequestSchema).parse(
          (
            await tx.execute(
              sql`select r.category, r.due_on::text as due_on from content_requests r
                  where r.creator_id = ${creatorId}::uuid and r.state = 'open'
                    and not exists (select 1 from content_drops d
                      where d.request_id = r.id and d.creator_id = r.creator_id and d.state <> 'withdrawn')
                  order by r.due_on, r.created_at`,
            )
          ).rows,
        );
        const members = z
          .array(NameSchema)
          .parse((await tx.execute(sql`select id, display_name from team_members`)).rows);
        return {
          timezone: her.timezone,
          scope,
          switches,
          pausedUntil,
          hoursNow,
          autoConversations: counts?.auto ?? 0,
          hasActivePersona: counts?.persona ?? false,
          expiredSessions,
          requests: requests.map((row) => ({ category: row.category, dueOn: row.due_on })),
          names: new Map(members.map((row) => [row.id, row.display_name] as const)),
        };
      }),
  };
}
