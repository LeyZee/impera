import {
  CurrencySchema,
  PlatformSchema,
  type CreatorId,
  type Platform,
  type UserId,
} from '@impera/contracts';
import { sql, withTenantMember, type Database } from '@impera/db';
import { z } from 'zod';

import type { AgencyCreatorRead } from '../../domain/agency-insights';

import type { SalesTotalsOf } from './reveal-sales-reader';

/** What the route reads of one creator: nothing out of the account's team scope, nothing before a register is linked. */
type AgencyCreatorAnswer =
  | { readonly kind: 'out_of_scope' }
  | { readonly kind: 'not_linked' }
  | { readonly kind: 'read'; readonly read: AgencyCreatorRead };

export interface AgencyInsightsReader {
  /** One creator, in her tenant, as `userId`: `range` runs from the previous period's first day to today. */
  read(
    creatorId: CreatorId,
    userId: UserId,
    range: { readonly from: string; readonly previousFrom: string; readonly to: string },
  ): Promise<AgencyCreatorAnswer>;
  /** Display names of the team, member id to name, read as `userId` through the first creator given. */
  memberNames(creatorId: CreatorId, userId: UserId): Promise<ReadonlyMap<string, string>>;
}

const LinkedSchema = z.array(z.object({ platform: PlatformSchema }));
const NameSchema = z.array(z.object({ display_name: z.string() }));
const HourSchema = z.array(
  z.object({
    iso_day: z.coerce.number().int().min(1).max(7),
    hour: z.coerce.number().int().min(0).max(23),
    currency: CurrencySchema,
    gross: z.coerce.number().int(),
  }),
);
const FanSchema = z.array(
  z.object({
    account: z.string(),
    fan: z.string(),
    currency: CurrencySchema,
    gross: z.coerce.number().int(),
    seen_before: z.boolean(),
  }),
);
const CountSchema = z.array(z.object({ paying: z.coerce.number().int().nonnegative() }));
const MemberSchema = z.array(z.object({ id: z.string(), display_name: z.string() }));

/**
 * The agency's read (ADR 0078 § 1, § 5): one creator at a time, inside her tenant (`platform_sales` is under RLS by
 * creator) and with the account's team scope. A scope of one's own reads nothing, not even the totals: with his own
 * sales he would get the others' (ADR 0043 § 7). `timeZoneOf` gives a platform's days' zone (the connectors').
 */
export function createAgencyInsightsReader(
  db: Database,
  totalsOf: SalesTotalsOf,
  timeZoneOf: (platform: Platform) => string | null,
): AgencyInsightsReader {
  return {
    read: (creatorId, userId, range) =>
      withTenantMember(db, creatorId, userId, async (tx, scope): Promise<AgencyCreatorAnswer> => {
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
        const totals = await totalsOf(tx, { creatorId, from: range.previousFrom, to: range.to });
        // The period's instants: from the first day's midnight to the midnight after today, in the platform's zone.
        const start = sql`((${range.from}::date)::timestamp at time zone ${zone})`;
        const end = sql`((${range.to}::date + 1)::timestamp at time zone ${zone})`;
        const previousStart = sql`((${range.previousFrom}::date)::timestamp at time zone ${zone})`;
        const hours = HourSchema.parse(
          (
            await tx.execute(sql`
              select extract(isodow from l.occurred_at at time zone ${zone})::int as iso_day,
                     extract(hour from l.occurred_at at time zone ${zone})::int as hour,
                     l.currency, sum(l.gross_incl_vat_minor)::bigint as gross
                from platform_sales l
               where l.creator_id = ${creatorId}::uuid and l.event = 'sale'
                 and l.occurred_at >= ${start} and l.occurred_at < ${end}
               group by 1, 2, 3`)
          ).rows,
        );
        const fans = FanSchema.parse(
          (
            await tx.execute(sql`
              with spent as (
                select l.platform_account_id::text as account, l.platform_fan_id as fan, l.currency,
                       sum(l.gross_incl_vat_minor)::bigint as gross
                  from platform_sales l
                 where l.creator_id = ${creatorId}::uuid and l.event = 'sale' and l.platform_fan_id is not null
                   and l.occurred_at >= ${start} and l.occurred_at < ${end}
                 group by 1, 2, 3)
              select s.account, s.fan, s.currency, s.gross,
                     exists (
                       select 1 from platform_sales p
                        where p.creator_id = ${creatorId}::uuid and p.event = 'sale'
                          and p.platform_account_id::text = s.account and p.platform_fan_id = s.fan
                          and p.occurred_at < ${start}) as seen_before
                from spent s`)
          ).rows,
        );
        const [previous] = CountSchema.parse(
          (
            await tx.execute(sql`
              select count(distinct (l.platform_account_id, l.platform_fan_id)) as paying
                from platform_sales l
               where l.creator_id = ${creatorId}::uuid and l.event = 'sale' and l.platform_fan_id is not null
                 and l.occurred_at >= ${previousStart} and l.occurred_at < ${start}`)
          ).rows,
        );
        return {
          kind: 'read',
          read: {
            creatorId,
            name: creator.display_name,
            totals,
            hours: hours.map((row) => ({
              isoDay: row.iso_day,
              hour: row.hour,
              currency: row.currency,
              grossMinor: row.gross,
            })),
            fans: fans.map((row) => ({
              key: `${row.account}:${row.fan}`,
              currency: row.currency,
              grossMinor: row.gross,
              seenBefore: row.seen_before,
            })),
            previousPaying: previous?.paying ?? 0,
          },
        };
      }),
    memberNames: (creatorId, userId) =>
      withTenantMember(db, creatorId, userId, async (tx) => {
        const rows = MemberSchema.parse(
          (await tx.execute(sql`select id, display_name from team_members`)).rows,
        );
        return new Map(rows.map((row) => [row.id, row.display_name] as const));
      }),
  };
}
