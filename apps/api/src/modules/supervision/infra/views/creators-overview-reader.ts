import { DropCategorySchema } from '@impera/contracts';
import { sql, withTenantMember, type Database } from '@impera/db';
import { z } from 'zod';

import type { CreatorOverviewView } from '../../domain/dashboard-ports';

const CreatorSchema = z.object({ timezone: z.string().min(1) });
const SwitchSchema = z.object({ scope: z.string(), active: z.boolean() });
const CountSchema = z.object({ auto: z.coerce.number().int().nonnegative() });
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
          sql`select timezone from creators where id = ${creatorId}::uuid and archived_at is null`,
        );
        const [her] = z.array(CreatorSchema).parse(creator.rows);
        if (her === undefined) return undefined;
        const stopped = z.array(SwitchSchema).parse(
          (
            await tx.execute(
              sql`select distinct on (scope) scope, active from kill_switches
                  where scope = 'global' or (scope = 'creator' and scope_id = ${creatorId}::uuid)
                  order by scope, set_at desc`,
            )
          ).rows,
        );
        const [counts] = z.array(CountSchema).parse(
          (
            await tx.execute(
              sql`select count(*) filter (where mode = 'auto' and state not in ('human', 'paused')) as auto
                  from conversations`,
            )
          ).rows,
        );
        const switches = {
          global: stopped.some((s) => s.scope === 'global' && s.active),
          creator: stopped.some((s) => s.scope === 'creator' && s.active),
        };
        if (scope === 'self') {
          return {
            timezone: her.timezone,
            scope,
            switches,
            autoConversations: counts?.auto ?? 0,
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
          autoConversations: counts?.auto ?? 0,
          requests: requests.map((row) => ({ category: row.category, dueOn: row.due_on })),
          names: new Map(members.map((row) => [row.id, row.display_name] as const)),
        };
      }),
  };
}
