import {
  CreatorSettingsSchema,
  fanTierOf,
  type CreatorId,
  type FanId,
  type FanStanding,
  type FanTiersSetting,
} from '@impera/contracts';
import { eq, schema, sql, type Transaction } from '@impera/db';
import { z } from 'zod';

/**
 * What a fan paid her, as « Fans » reads it (ADR 0124): the platform's register, his sales less their refunds, by
 * currency, VAT included as Reveal shows it; his dollars at the last known rate, none known and they do not count.
 * Shared by « À qui parler » and the extension's panel (Charles, 21/11).
 */

const RateRowsSchema = z.array(z.object({ rate_micros: z.coerce.number().int().positive() }));
const PaidRowsSchema = z.array(
  z.object({
    eur_minor: z.coerce.number().int(),
    usd_minor: z.coerce.number().int(),
    first_seen_at: z.union([z.string(), z.date()]).transform((v) => (v instanceof Date ? v : new Date(v))),
    last_purchase_at: z
      .union([z.string(), z.date()])
      .nullable()
      .transform((v) => (v === null ? null : v instanceof Date ? v : new Date(v))),
  }),
);

/** Her tier thresholds (the defaults for settings that no longer read) and the last dollar rate known. */
export async function tiersAndRate(
  tx: Transaction,
  creatorId: CreatorId,
): Promise<{ readonly tiers: FanTiersSetting; readonly rateMicros: number | null }> {
  const [creator] = await tx
    .select({ settings: schema.creators.settings })
    .from(schema.creators)
    .where(eq(schema.creators.id, creatorId));
  const settings = CreatorSettingsSchema.safeParse(creator?.settings ?? {});
  const rate = await tx.execute(
    sql`select rate_micros from exchange_rates where currency = 'USD' order by day desc limit 1`,
  );
  return {
    tiers: (settings.success ? settings.data : CreatorSettingsSchema.parse({})).fanTiers,
    rateMicros: RateRowsSchema.parse(rate.rows)[0]?.rate_micros ?? null,
  };
}

/** His euros and his dollars at that rate, in euro cents, never below zero. */
export const spentOf = (eurMinor: number, usdMinor: number, rateMicros: number | null): number =>
  Math.max(0, eurMinor + (rateMicros === null ? 0 : Math.round((usdMinor * rateMicros) / 1_000_000)));

/** The `net` and `paid` common table expressions of her register, by account and platform fan. */
export const paidTables = (creatorId: CreatorId): ReturnType<typeof sql> => sql`
  net as (
    select s.platform_account_id as account, s.platform_fan_id as fan, s.currency, s.occurred_at,
           s.gross_incl_vat_minor - coalesce(r.gross_incl_vat_minor, 0) as gross
      from platform_sales s
      left join platform_sales r
        on r.creator_id = ${creatorId}::uuid and r.event = 'refund'
       and r.platform = s.platform and r.platform_sale_id = s.platform_sale_id
     where s.creator_id = ${creatorId}::uuid and s.event = 'sale' and s.platform_fan_id is not null),
  paid as (
    select account, fan,
           coalesce(sum(gross) filter (where currency = 'EUR'), 0) as eur_minor,
           coalesce(sum(gross) filter (where currency = 'USD'), 0) as usd_minor,
           max(occurred_at) filter (where gross > 0) as last_purchase_at
      from net group by account, fan)`;

/** One fan's standing: what he spent, his tier, his last purchase. `null` when she has no such fan. */
export async function fanStanding(
  tx: Transaction,
  creatorId: CreatorId,
  fanId: FanId,
  now: Date,
): Promise<FanStanding | null> {
  const { tiers, rateMicros } = await tiersAndRate(tx, creatorId);
  const result = await tx.execute(sql`
    with ${paidTables(creatorId)}
    select coalesce(p.eur_minor, 0) as eur_minor, coalesce(p.usd_minor, 0) as usd_minor, f.first_seen_at,
           p.last_purchase_at
      from fans f
      left join paid p on p.account = f.platform_account_id and p.fan = f.platform_fan_id
     where f.id = ${fanId}::uuid and f.creator_id = ${creatorId}::uuid`);
  const [row] = PaidRowsSchema.parse(result.rows);
  if (row === undefined) return null;
  const spentMinor = spentOf(row.eur_minor, row.usd_minor, rateMicros);
  return {
    tier: fanTierOf({ spentMinor, fanSince: row.first_seen_at }, tiers, now),
    spentMinor,
    lastPurchaseAt: row.last_purchase_at?.toISOString() ?? null,
  };
}
