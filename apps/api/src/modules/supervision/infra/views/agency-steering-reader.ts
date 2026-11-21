import { CurrencySchema, PlatformSchema, type Platform } from '@impera/contracts';
import { sql, withTenantMember, type Database } from '@impera/db';
import { z } from 'zod';

import { shiftDay } from '../../domain/agency-insights';
import type { AgencySteeringReader, SteeringCreatorAnswer } from '../../domain/agency-steering';

import type { DailyStatsOf } from './agency-insights-reader';

const LinkedSchema = z.array(z.object({ platform: PlatformSchema }));
const DaySchema = z.array(
  z.object({
    day: z.iso.date(),
    currency: CurrencySchema,
    gross: z.coerce.number().int(),
    sales: z.coerce.number().int().nonnegative(),
  }),
);
const HourSchema = z.array(
  z.object({
    day: z.iso.date(),
    hour: z.coerce.number().int().min(0).max(23),
    currency: CurrencySchema,
    gross: z.coerce.number().int(),
  }),
);
const FanSchema = z.array(
  z.object({
    key: z.string(),
    fan_name: z.string().nullable(),
    conversation_id: z.string().nullable(),
    currency: CurrencySchema,
    first_day: z.iso.date(),
    last_day: z.iso.date(),
    lifetime: z.coerce.number().int(),
    window_minor: z.coerce.number().int(),
    window_purchases: z.coerce.number().int().nonnegative(),
    previous_purchases: z.coerce.number().int().nonnegative(),
    withheld: z.boolean(),
  }),
);
const WroteSchema = z.array(
  z.object({
    conversations: z.coerce.number().int().nonnegative(),
    current: z.coerce.number().int().nonnegative(),
    previous: z.coerce.number().int().nonnegative(),
  }),
);
const NameSchema = z.array(z.object({ display_name: z.string() }));
const SinceSchema = z.array(z.object({ since: z.iso.date().nullable() }));
const ObjectiveSchema = z.array(z.object({ amount_minor: z.coerce.number().int().positive() }));
const AccountSchema = z.array(z.object({ id: z.string() }));

/**
 * The steering's read (ADR 0092, avenant du 21/11/2026): one creator at a time, inside her tenant and with the
 * account's team scope, as the agency's figures are read (a scope of one's own reads nothing). A sale's refund comes
 * off its sale's day.
 */
export function createAgencySteeringReader(
  db: Database,
  timeZoneOf: (platform: Platform) => string | null,
  statsOf: DailyStatsOf,
): AgencySteeringReader {
  return {
    read: (creatorId, userId, range) =>
      withTenantMember(db, creatorId, userId, async (tx, scope): Promise<SteeringCreatorAnswer> => {
        if (scope === 'self') return { kind: 'out_of_scope' };
        const linked = LinkedSchema.parse(
          (
            await tx.execute(
              sql`select distinct platform from sales_feed_models where creator_id = ${creatorId}::uuid order by platform`,
            )
          ).rows,
        );
        const zone = linked.map((row) => timeZoneOf(row.platform)).find((one) => one !== null);
        if (zone === undefined) return { kind: 'not_linked' };
        const [creator] = NameSchema.parse(
          (await tx.execute(sql`select display_name from creators where id = ${creatorId}::uuid`)).rows,
        );
        if (creator === undefined) return { kind: 'not_linked' };
        const startOf = (day: string) => sql`((${day}::date)::timestamp at time zone ${zone})`;
        const end = sql`((${range.today}::date + 1)::timestamp at time zone ${zone})`;
        const start = startOf(range.from);
        const previousStart = startOf(range.previousFrom);
        // Each sale less its refund, when refunded (the register is unique by sale and event).
        const netSales = sql`
          select s.platform_account_id as account, s.platform_fan_id as fan, s.currency, s.occurred_at,
                 s.gross_incl_vat_minor - coalesce(r.gross_incl_vat_minor, 0) as net
            from platform_sales s
            left join platform_sales r
              on r.creator_id = ${creatorId}::uuid and r.event = 'refund'
             and r.platform = s.platform and r.platform_sale_id = s.platform_sale_id
           where s.creator_id = ${creatorId}::uuid and s.event = 'sale'`;
        const days = DaySchema.parse(
          (
            await tx.execute(sql`
              with n as (${netSales})
              select (n.occurred_at at time zone ${zone})::date::text as day, n.currency,
                     sum(n.net)::bigint as gross, count(*) as sales
                from n
               where n.occurred_at >= ${previousStart} and n.occurred_at < ${end}
               group by 1, 2`)
          ).rows,
        );
        const hours = HourSchema.parse(
          (
            await tx.execute(sql`
              with n as (${netSales})
              select (n.occurred_at at time zone ${zone})::date::text as day,
                     extract(hour from n.occurred_at at time zone ${zone})::int as hour,
                     n.currency, sum(n.net)::bigint as gross
                from n
               where n.occurred_at >= ${startOf(range.profileFrom)} and n.occurred_at < ${end}
               group by 1, 2, 3`)
          ).rows,
        );
        // Every fan of the register: his spend ever and in the window, his purchases in both windows; his pseudonym
        // and his conversation in Suivi, when Impera knows them (ADR 0092 § 3).
        const fans = FanSchema.parse(
          (
            await tx.execute(sql`
              with n as (${netSales}),
              p as (
                select n.account, n.fan, n.currency,
                       min(n.occurred_at at time zone ${zone})::date::text as first_day,
                       max(n.occurred_at at time zone ${zone})::date::text as last_day,
                       sum(n.net)::bigint as lifetime,
                       coalesce(sum(n.net) filter (where n.occurred_at >= ${start} and n.occurred_at < ${end}), 0)::bigint
                         as window_minor,
                       count(*) filter (where n.occurred_at >= ${start} and n.occurred_at < ${end}) as window_purchases,
                       count(*) filter (where n.occurred_at >= ${previousStart} and n.occurred_at < ${start})
                         as previous_purchases
                  from n
                 where n.fan is not null
                 group by 1, 2, 3)
              select p.account::text || ':' || p.fan as key, f.display_name as fan_name,
                     (select c.id::text from conversations c
                       where c.creator_id = ${creatorId}::uuid and c.fan_id = f.id
                       order by c.last_inbound_at desc nulls last limit 1) as conversation_id,
                     p.currency, p.first_day, p.last_day, p.lifetime, p.window_minor, p.window_purchases,
                     p.previous_purchases,
                     -- Never named among the lapsed: an open care episode, or a doubt on his age (a « minor » handoff)
                     -- with no hand given back since, on any of his conversations with her (Sécurité, 21/11).
                     coalesce(exists (
                       select 1 from conversations c
                        where c.creator_id = ${creatorId}::uuid and c.fan_id = f.id
                          and (c.care_since is not null
                               or exists (
                                 select 1 from conversation_events e
                                  where e.conversation_id = c.id and e.type = 'handoff_requested'
                                    and e.payload->>'cause' = 'minor'
                                    and e.seq > coalesce((select max(t.seq) from conversation_events t
                                                          where t.conversation_id = c.id
                                                            and t.type = 'takeover_ended'), -1)))), false)
                       as withheld
                from p
                left join fans f
                  on f.creator_id = ${creatorId}::uuid and f.platform_account_id = p.account and f.platform_fan_id = p.fan`)
          ).rows,
        );
        // Fans whose first message arrived in each window, among the conversations Impera reads.
        const [wrote] = WroteSchema.parse(
          (
            await tx.execute(sql`
              with firsts as (
                select m.conversation_id, min(m.platform_created_at) as first_at
                  from messages m
                 where m.creator_id = ${creatorId}::uuid and m.direction = 'inbound'
                 group by 1)
              select (select count(*) from conversations where creator_id = ${creatorId}::uuid) as conversations,
                     count(*) filter (where first_at >= ${start} and first_at < ${end}) as current,
                     count(*) filter (where first_at >= ${previousStart} and first_at < ${start}) as previous
                from firsts`)
          ).rows,
        );
        const [first] = SinceSchema.parse(
          (
            await tx.execute(sql`
              select (min(occurred_at) at time zone ${zone})::date::text as since
                from platform_sales where creator_id = ${creatorId}::uuid`)
          ).rows,
        );
        const [objective] = ObjectiveSchema.parse(
          (
            await tx.execute(sql`
              select amount_minor from creator_revenue_objectives
               where creator_id = ${creatorId}::uuid and month = ${range.monthFrom}::date`)
          ).rows,
        );
        // Kept to her own accounts, whatever the policy gives the transaction.
        const mine = new Set(
          AccountSchema.parse(
            (
              await tx.execute(
                sql`select id::text as id from platform_accounts where creator_id = ${creatorId}::uuid`,
              )
            ).rows,
          ).map((row) => row.id),
        );
        const stats = (await statsOf(tx, { from: shiftDay(range.previousFrom, -1), to: range.today })).filter(
          (line) => mine.has(line.platformAccountId),
        );
        return {
          kind: 'read',
          read: {
            creatorId,
            name: creator.display_name,
            registerSince: first?.since ?? null,
            objectiveMinor: objective?.amount_minor ?? null,
            days: days.map((row) => ({
              day: row.day,
              currency: row.currency,
              grossMinor: row.gross,
              sales: row.sales,
            })),
            hours: hours.map((row) => ({
              day: row.day,
              hour: row.hour,
              currency: row.currency,
              grossMinor: row.gross,
            })),
            fans: fans.map((row) => ({
              key: row.key,
              fanName: row.fan_name,
              conversationId: row.conversation_id,
              currency: row.currency,
              firstDay: row.first_day,
              lastDay: row.last_day,
              lifetimeMinor: row.lifetime,
              windowMinor: row.window_minor,
              windowPurchases: row.window_purchases,
              previousPurchases: row.previous_purchases,
              withheld: row.withheld,
            })),
            wrote:
              wrote === undefined || wrote.conversations === 0
                ? null
                : { current: wrote.current, previous: wrote.previous },
            stats,
          },
        };
      }),
  };
}
