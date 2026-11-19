import { AiProviderSchema, type AiProvider, type ProviderActivity } from '@impera/contracts';
import { sql, type Database } from '@impera/db';
import { z } from 'zod';

import { troubleOf, type ActivityReader } from '../domain/probe';

/** The journal outcomes that say something of the connection (`troubleOf`). */
const TROUBLES = [
  'quota_exhausted',
  'auth',
  'unknown_model',
  'rate_limited',
  'timeout',
  'unavailable',
  'error',
];
const troubles = sql.join(
  TROUBLES.map((outcome) => sql`${outcome}`),
  sql`, `,
);

const DAY_MS = 86_400_000;
/** How far back a last trouble is still told. */
const TROUBLE_LOOKBACK_MS = 7 * DAY_MS;

const RowSchema = z.object({
  provider: AiProviderSchema,
  calls: z.coerce.number().int().nonnegative(),
  troubled: z.coerce.number().int().nonnegative(),
  as_fallback: z.coerce.number().int().nonnegative(),
  last_success_at: z.coerce.date().nullable(),
  last_trouble_at: z.coerce.date().nullable(),
  last_trouble_status: z.string().nullable(),
});

/**
 * Each service's real calls (ADR 0091 § 7), read in `llm_calls` with the owner role like Consommation IA: all creators,
 * the playground and the owner's « Essai réel » together. A hedge's loser was waited for by nobody: left out.
 */
export function createPostgresActivityReader(adminDb: Database): ActivityReader {
  return {
    async last24h(now) {
      const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
      const weekAgo = new Date(now.getTime() - TROUBLE_LOOKBACK_MS).toISOString();
      const result = await adminDb.execute(sql`
        with recent as (
          select provider, status, is_fallback, created_at from llm_calls
          where created_at >= ${weekAgo}::timestamptz and hedge is distinct from 'loser'
        ), last_trouble as (
          select distinct on (provider) provider, created_at, status from recent
          where status in (${troubles}) order by provider, created_at desc
        )
        select r.provider,
               count(*) filter (where r.created_at >= ${dayAgo}::timestamptz) as calls,
               count(*) filter (where r.created_at >= ${dayAgo}::timestamptz and r.status in (${troubles}))
                 as troubled,
               count(*) filter (where r.created_at >= ${dayAgo}::timestamptz and r.is_fallback) as as_fallback,
               max(r.created_at) filter (where r.status = 'ok') as last_success_at,
               t.created_at as last_trouble_at, t.status as last_trouble_status
        from recent r left join last_trouble t on t.provider = r.provider
        group by r.provider, t.created_at, t.status`);
      const activity = new Map<AiProvider, ProviderActivity>();
      for (const row of z.array(RowSchema).parse(result.rows)) {
        const kind = row.last_trouble_status === null ? null : troubleOf(row.last_trouble_status);
        const isSolved =
          row.last_trouble_at !== null &&
          row.last_success_at !== null &&
          row.last_success_at > row.last_trouble_at;
        activity.set(row.provider, {
          calls: row.calls,
          troubled: row.troubled,
          asFallback: row.as_fallback,
          lastSuccessAt: row.last_success_at?.toISOString() ?? null,
          lastTrouble:
            kind === null || row.last_trouble_at === null || isSolved
              ? null
              : { at: row.last_trouble_at.toISOString(), kind },
        });
      }
      return activity;
    },
  };
}
