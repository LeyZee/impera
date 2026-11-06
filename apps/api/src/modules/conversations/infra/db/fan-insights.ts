import type { CreatorFanInsights } from '@impera/contracts';
import { sql, type Transaction } from '@impera/db';
import { z } from 'zod';

import { FIGURE_KEYS, fanFigures, type FigureKey } from '../../../fans';

const count = z.coerce.number().int().nonnegative();

/**
 * The rows of « Qui sont tes fans » (CR-15), read in her own transaction (`withCreatorAccount`, RLS on her creator),
 * then ranked by the `fans` module: no value a fan wrote leaves the server, only shares (ADR 0074 § 7 and § 8).
 *
 * Everything stops at the last midnight before `now` in her time zone (§ 2): the fans first seen before it, and the
 * facts active then, written before it, not superseded by a fact written before it, not expired at it (§ 1). Only
 * declared facts, never a chatter's note nor a commercial fact, and the filter is in the query itself (Bilan, #605).
 */
export async function readFanInsights(
  tx: Transaction,
  creatorId: string,
  now: Date,
): Promise<CreatorFanInsights> {
  const day = await tx.execute(
    sql`select (date_trunc('day', ${now.toISOString()}::timestamptz at time zone c.timezone)
                  at time zone c.timezone) as midnight,
               c.timezone
        from creators c where c.id = ${creatorId}::uuid`,
  );
  const [{ midnight: asOf, timezone }] = z
    .tuple([z.object({ midnight: z.coerce.date(), timezone: z.string() })])
    .parse(day.rows);
  const at = asOf.toISOString();

  const fans = await tx.execute(
    sql`select count(*) as total,
               count(*) filter (where f.first_seen_at >= ${at}::timestamptz - interval '30 days') as new_30,
               (select count(distinct c.fan_id) from messages m
                  join conversations c on c.id = m.conversation_id
                  where m.direction = 'inbound'
                    and m.platform_created_at >= ${at}::timestamptz - interval '7 days'
                    and m.platform_created_at < ${at}::timestamptz) as wrote_7
        from fans f where f.first_seen_at < ${at}::timestamptz`,
  );
  const [counts] = z.tuple([z.object({ total: count, new_30: count, wrote_7: count })]).parse(fans.rows);

  const facts = await tx.execute(
    sql`select distinct on (f.fan_id, k.key) f.fan_id, k.key, f.value
        from fan_facts f
        cross join lateral (select lower(regexp_replace(btrim(f.key), '\\s+', '_', 'g')) as key) k
        join fans fa on fa.id = f.fan_id
        where f.kind = 'declared'
          and f.category not in ('operator_note', 'commercial')
          and k.key = any(${sql.param([...FIGURE_KEYS])}::text[])
          and fa.first_seen_at < ${at}::timestamptz
          and not (fa.flags ? 'ageDisputed')
          and f.created_at < ${at}::timestamptz
          and (f.expires_at is null or f.expires_at > ${at}::timestamptz)
          and (f.superseded_by is null
               or (select r.created_at from fan_facts r where r.id = f.superseded_by) >= ${at}::timestamptz)
        order by f.fan_id, k.key, f.observed_at desc, f.id desc`,
  );
  const factRows = z
    .array(z.object({ fan_id: z.string(), key: z.enum(FIGURE_KEYS), value: z.string() }))
    .parse(facts.rows);

  const spending = await tx.execute(
    sql`select f.id,
               coalesce(sum(m.price_minor) filter (where m.currency = 'EUR'), 0) as eur_minor,
               coalesce(sum(m.price_minor) filter (where m.currency = 'EUR'
                 and m.platform_created_at >= ${at}::timestamptz - interval '30 days'), 0) as eur_30_minor,
               count(m.id) as unlocked
        from fans f
        left join conversations c on c.fan_id = f.id
        left join messages m on m.conversation_id = c.id
          and m.direction = 'outbound' and m.is_paid and m.price_minor > 0
          and m.platform_created_at < ${at}::timestamptz
        where f.first_seen_at < ${at}::timestamptz
        group by f.id`,
  );
  const spent = z
    .array(z.object({ eur_minor: count, eur_30_minor: count, unlocked: count }))
    .parse(spending.rows);

  const activity = await tx.execute(
    sql`select (extract(isodow from m.platform_created_at at time zone ${timezone})::int - 1) as day,
               (extract(hour from m.platform_created_at at time zone ${timezone})::int / 3) as slot,
               count(*) as messages
        from messages m
        join conversations c on c.id = m.conversation_id
        where m.direction = 'inbound'
          and m.platform_created_at >= ${at}::timestamptz - interval '30 days'
          and m.platform_created_at < ${at}::timestamptz
        group by 1, 2`,
  );
  const cells = z.array(z.object({ day: count, slot: count, messages: count })).parse(activity.rows);
  const writers = await tx.execute(
    sql`select count(distinct c.fan_id) as fans
        from messages m
        join conversations c on c.id = m.conversation_id
        where m.direction = 'inbound'
          and m.platform_created_at >= ${at}::timestamptz - interval '30 days'
          and m.platform_created_at < ${at}::timestamptz`,
  );
  const [{ fans: activeFans }] = z.tuple([z.object({ fans: count })]).parse(writers.rows);

  const grid = Array.from({ length: 7 * 8 }, (_, i) => {
    const day = Math.floor(i / 8);
    const slot = i % 8;
    return {
      day,
      slot,
      messages: cells.find((c) => c.day === day && c.slot === slot)?.messages ?? 0,
    };
  });

  return fanFigures({
    asOf,
    fans: { total: counts.total, newLast30Days: counts.new_30, wroteLast7Days: counts.wrote_7 },
    facts: factRows.map((row) => ({ fanId: row.fan_id, key: row.key satisfies FigureKey, value: row.value })),
    spentMinor: spent.map((row) => row.eur_minor),
    basketsMinor: spent.filter((row) => row.eur_30_minor > 0).map((row) => row.eur_30_minor),
    payingFans: spent.filter((row) => row.unlocked > 0).length,
    activity: grid,
    activeFans,
  });
}
