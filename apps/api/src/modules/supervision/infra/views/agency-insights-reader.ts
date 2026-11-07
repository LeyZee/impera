import {
  CurrencySchema,
  PlatformSchema,
  SaleTypeSchema,
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
    sale_type: SaleTypeSchema,
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
    previous: z.boolean(),
    seen_before: z.boolean(),
  }),
);
const CountSchema = z.array(z.object({ refunds: z.coerce.number().int().nonnegative() }));
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
                     l.sale_type, l.currency, sum(l.gross_incl_vat_minor)::bigint as gross
                from platform_sales l
               where l.creator_id = ${creatorId}::uuid and l.event = 'sale'
                 and l.occurred_at >= ${start} and l.occurred_at < ${end}
               group by 1, 2, 3, 4`)
          ).rows,
        );
        // Each fan's sales of the period and of the one before, less their refunds whenever refunded (at most one per
        // sale: the register is unique by sale and event), and whether he bought before the period.
        const fans = FanSchema.parse(
          (
            await tx.execute(sql`
              with sold as (
                select s.platform, s.platform_sale_id, s.platform_account_id as account, s.platform_fan_id as fan,
                       s.currency, s.gross_incl_vat_minor as gross, s.occurred_at < ${start} as previous
                  from platform_sales s
                 where s.creator_id = ${creatorId}::uuid and s.event = 'sale' and s.platform_fan_id is not null
                   and s.occurred_at >= ${previousStart} and s.occurred_at < ${end}),
              spent as (
                select d.account, d.fan, d.currency, d.previous,
                       (sum(d.gross) - coalesce(sum(r.gross_incl_vat_minor), 0))::bigint as gross
                  from sold d
                  left join platform_sales r
                    on r.creator_id = ${creatorId}::uuid and r.event = 'refund'
                   and r.platform = d.platform and r.platform_sale_id = d.platform_sale_id
                 group by 1, 2, 3, 4),
              first as (
                select f.platform_account_id as account, f.platform_fan_id as fan, min(f.occurred_at) as first_at
                  from platform_sales f
                 where f.creator_id = ${creatorId}::uuid and f.event = 'sale' and f.platform_fan_id is not null
                 group by 1, 2)
              select p.account::text as account, p.fan, p.currency, p.gross, p.previous,
                     f.first_at < ${start} as seen_before
                from spent p
                join first f on f.account = p.account and f.fan = p.fan`)
          ).rows,
        );
        // A refund of the period whose sale the register does not hold: counted apart, as the totals do.
        const [orphans] = CountSchema.parse(
          (
            await tx.execute(sql`
              select count(*) as refunds
                from platform_sales r
               where r.creator_id = ${creatorId}::uuid and r.event = 'refund'
                 and r.occurred_at >= ${start} and r.occurred_at < ${end}
                 and not exists (
                   select 1 from platform_sales s
                    where s.creator_id = ${creatorId}::uuid and s.event = 'sale'
                      and s.platform = r.platform and s.platform_sale_id = r.platform_sale_id)`)
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
              saleType: row.sale_type,
              currency: row.currency,
              grossMinor: row.gross,
            })),
            fans: fans.map((row) => ({
              key: `${row.account}:${row.fan}`,
              currency: row.currency,
              grossMinor: row.gross,
              previous: row.previous,
              seenBefore: row.seen_before,
            })),
            refundsWithoutSale: orphans?.refunds ?? 0,
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
