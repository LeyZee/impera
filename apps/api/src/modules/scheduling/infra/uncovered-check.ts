import {
  AgentHoursSchema,
  AgentModeSchema,
  CreatorIdSchema,
  EVENT_PAYLOADS,
  EventIdSchema,
  newId,
} from '@impera/contracts';
import { schema, sql, withAdmin, type Database } from '@impera/db';
import { z } from 'zod';

import type { CreatorAgent } from '../domain/calendar';
import { heldUntil } from '../domain/shifts';
import {
  UNCOVERED_FAN_RECENT_MS,
  UNCOVERED_LOOKBACK_MS,
  uncoveredSlotStarts,
  type UncoveredSlot,
} from '../domain/uncovered';

import { plannedMembersOf, settingsIn, shiftColumns, StoredAccountSchema, toShift } from './rows';

const AgentRowSchema = z.object({
  creator_id: CreatorIdSchema,
  time_zone: z.string().min(1),
  mode: AgentModeSchema,
  reply: AgentHoursSchema.shape.reply,
});

/**
 * The agent of every creator not archived, as `calendar_agent()` (migration 0069, kept by 0226) decides it for the
 * agency: Arrêt under a stop of the agency or of hers still running, Automatique where one of her conversations is, else
 * Copilote; her reply hours or « toujours ». Read here on the admin connection, which that function does not serve.
 */
const agentsQuery = sql`
  with global_stop as (
    select coalesce((
      select k.active and (k.active_until is null or k.active_until > now())
        from kill_switches k
       where k.scope = 'global'
       order by k.set_at desc
       limit 1), false) as active
  )
  select c.id as creator_id,
         c.timezone as time_zone,
         case
           when (select active from global_stop) then 'stop'
           when coalesce((
             select k.active and (k.active_until is null or k.active_until > now())
               from kill_switches k
              where k.scope = 'creator' and k.scope_id = c.id
              order by k.set_at desc
              limit 1), false) then 'stop'
           when exists (
             select 1 from conversations v
              where v.creator_id = c.id and v.mode = 'auto' and v.state not in ('human', 'paused')
           ) then 'auto'
           else 'copilot'
         end as mode,
         coalesce(c.agent_hours -> 'reply', '{"mode":"always"}'::jsonb) as reply
    from creators c
   where c.archived_at is null
   order by c.id`;

/**
 * « Compte sans personne » (ADR 0094 § 1, lot a), on the admin connection: the créneaux that began in the last minutes
 * with nobody answering (`uncoveredSlotStarts`), on the accounts of the creators not archived, and of those, the ones
 * whose account a fan wrote to in the 24 hours before the créneau began. One `account_uncovered` per account and
 * créneau (index `domain_events_account_uncovered_unique`), so a run again publishes nothing new. It writes nothing
 * but the outbox: no shift, no mode, no pay (§ 4). The alert router (ADR 0150) and Telegram tell the owner and the
 * managers; never a chatter (§ 3).
 */
export function createDrizzleUncoveredCheck(adminDb: Database): {
  run(now: Date, correlationId: string): Promise<number>;
} {
  return {
    run: (now, correlationId) =>
      withAdmin(adminDb, async (tx) => {
        const since = new Date(now.getTime() - UNCOVERED_LOOKBACK_MS);
        const settings = await settingsIn(tx, { from: since, to: now }, true);
        const agents: CreatorAgent[] = (await tx.execute(agentsQuery)).rows.map((raw) => {
          const row = AgentRowSchema.parse(raw);
          return { creatorId: row.creator_id, timeZone: row.time_zone, mode: row.mode, reply: row.reply };
        });
        if (agents.length === 0) return 0;
        const open = new Set<string>(agents.map((agent) => agent.creatorId));
        const accounts = (
          await tx
            .select({
              id: schema.platformAccounts.id,
              creatorId: schema.platformAccounts.creatorId,
              platform: schema.platformAccounts.platform,
              handle: schema.platformAccounts.handle,
            })
            .from(schema.platformAccounts)
        )
          .map((row) => StoredAccountSchema.parse(row))
          .filter((account) => open.has(account.creatorId));
        if (accounts.length === 0) return 0;
        const planned = (
          await tx
            .select(shiftColumns)
            .from(schema.shifts)
            .where(
              sql`${schema.shifts.cancelledAt} is null and ${schema.shifts.startsAt} <= ${now} and ${schema.shifts.endsAt} > ${since}`,
            )
        ).map(toShift);
        const members = new Map(
          (await plannedMembersOf(tx, [...new Set(planned.map((shift) => shift.memberId))])).map((member) => [
            member.id,
            member,
          ]),
        );
        const slots = uncoveredSlotStarts({
          settings,
          accounts,
          shifts: heldUntil(members, planned, now),
          agents,
          now,
        });
        const platformOf = new Map(accounts.map((account) => [account.id, account.platform]));
        let published = 0;
        for (const slot of slots) {
          if (!(await fanWroteBefore(slot))) continue;
          const platform = platformOf.get(slot.platformAccountId);
          if (platform === undefined) continue;
          const rows = await tx
            .insert(schema.domainEvents)
            .values({
              id: newId(EventIdSchema),
              creatorId: slot.creatorId,
              type: 'account_uncovered',
              payload: EVENT_PAYLOADS.account_uncovered.parse({
                creatorId: slot.creatorId,
                platform,
                platformAccountId: slot.platformAccountId,
                slotStartsAt: slot.startsAt.toISOString(),
                slotEndsAt: slot.endsAt.toISOString(),
                timeZone: settings.timeZone,
              }),
              actor: 'system',
              correlationId,
            })
            .onConflictDoNothing()
            .returning({ id: schema.domainEvents.id });
          published += rows.length;
        }
        return published;

        /** A fan's message on the account in the 24 hours before the créneau began (index `messages_account_fan_recent_idx`). */
        async function fanWroteBefore(slot: UncoveredSlot): Promise<boolean> {
          const from = new Date(slot.startsAt.getTime() - UNCOVERED_FAN_RECENT_MS);
          const found = await tx.execute(sql`
            select 1 from messages
             where platform_account_id = ${slot.platformAccountId}
               and direction = 'inbound'
               and platform_created_at > ${from}
               and platform_created_at <= ${slot.startsAt}
             limit 1`);
          return found.rows.length > 0;
        }
      }),
  };
}
