import {
  AiCreditCurrencySchema,
  AiCreditEntryKindSchema,
  AiCreditProviderSchema,
  AiUsageProviderSchema,
  AiSpendLineSchema,
  AiUsageUseSchema,
  AuditEntryIdSchema,
  EventIdSchema,
  EVENT_PAYLOADS,
  newId,
  type AiCreditEntry,
} from '@impera/contracts';
import { eq, schema, sql, withAdmin, type Database } from '@impera/db';
import { UNBILLED_OUTCOMES, UNKNOWN_CALL_COST_USD } from '@impera/llm';
import { z } from 'zod';

import type { CreditAlerts, CreditLedger, UsageReader } from '../domain/ports';

/**
 * What a call cost in USD, as the daily cap counts it (`billedUsd` in packages/llm): its journaled cost, else nothing
 * when the provider refused it before any work, else the gateway's estimate for an unknown cost.
 */
const unbilled = sql.join(
  [...UNBILLED_OUTCOMES].map((outcome) => sql`${outcome}`),
  sql`, `,
);
const billedUsd = sql`coalesce(cost_micro_usd::numeric / 1000000,
  case when status in (${unbilled}) then 0::numeric else ${UNKNOWN_CALL_COST_USD}::numeric end)`;

const RowSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  hour: z.coerce.number().int().min(0).max(23),
  provider: AiUsageProviderSchema,
  model: z.string().min(1),
  use: AiUsageUseSchema,
  // `numeric` and `bigint` sums come back as strings.
  usd: z.coerce.number().nonnegative(),
  calls: z.coerce.number().int().nonnegative(),
  failed: z.coerce.number().int().nonnegative(),
  fallback: z.coerce.number().int().nonnegative(),
  input_tokens: z.coerce.number().int().nonnegative(),
  output_tokens: z.coerce.number().int().nonnegative(),
});

const ForecastReadSchema = z.object({
  kind: z.enum(['call', 'sale']),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  line: AiSpendLineSchema.nullable(),
  creator_id: z.uuid().nullable(),
  amount: z.coerce.number(),
  conversations: z.coerce.number().int().nonnegative(),
  name: z.string().nullable(),
});

/** `llm_calls` with the owner role, as the gateway's journal reads it: all creators and the playground together. */
export function createPostgresUsageReader(adminDb: Database): UsageReader {
  return {
    async rows(from, timeZone) {
      const local = sql`(created_at at time zone ${timeZone})`;
      const result = await adminDb.execute(sql`
        select to_char(${local}, 'YYYY-MM-DD') as day, extract(hour from ${local})::int as hour, provider, model,
               case when purpose in ('trend_watch', 'probe', 'instagram_comment') then purpose else role end as use,
               sum(${billedUsd}) as usd, count(*) as calls,
               count(*) filter (where status <> 'ok') as failed,
               count(*) filter (where is_fallback) as fallback,
               coalesce(sum(input_tokens), 0) as input_tokens, coalesce(sum(output_tokens), 0) as output_tokens
        from llm_calls where created_at >= ${from.toISOString()}::timestamptz
        group by 1, 2, 3, 4, 5`);
      return z
        .array(RowSchema)
        .parse(result.rows)
        .map((row) => ({
          day: row.day,
          hour: row.hour,
          provider: row.provider,
          model: row.model,
          use: row.use,
          usd: row.usd,
          calls: row.calls,
          failed: row.failed,
          fallback: row.fallback,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
        }));
    },
    async lastCallAt(from) {
      const result = await adminDb.execute(sql`
        select max(created_at) as at from llm_calls where created_at >= ${from.toISOString()}::timestamptz`);
      return z.object({ at: z.coerce.date().nullable() }).parse(result.rows[0] ?? { at: null }).at;
    },
    async spentSince(provider, after) {
      const result = await adminDb.execute(sql`
        select coalesce(sum(${billedUsd}), 0) as usd from llm_calls
        where provider = ${provider} and created_at > ${after.toISOString()}::timestamptz`);
      return z.object({ usd: z.coerce.number() }).parse(result.rows[0] ?? { usd: 0 }).usd;
    },
    async forecast(from, timeZone) {
      // One read (ADR 0091 § 8): the calls by line of spend, the sales net of the platform (euro lines, a refund taken
      // off its day), each with its creator's name. A call of no creator with no other purpose is the playground or a
      // test.
      const result = await adminDb.execute(sql`
        with lined as (
          select to_char(created_at at time zone ${timeZone}, 'YYYY-MM-DD') as day, creator_id, conversation_id,
                 ${billedUsd} as usd,
                 case when purpose in ('trend_watch', 'instagram_comment') then 'instagram'
                      when purpose = 'media' then 'media'
                      when purpose = 'telegram' then 'telegram'
                      when purpose = 'probe' then 'other'
                      when role = 'judge' or creator_id is null then 'playground'
                      else 'chatting' end as line
          from llm_calls where created_at >= ${from.toISOString()}::timestamptz),
        calls as (
          select 'call' as kind, day, line, creator_id, sum(usd) as amount,
                 count(distinct conversation_id) filter (where line = 'chatting') as conversations
          from lined group by 2, 3, 4),
        sold as (
          select 'sale' as kind, to_char(occurred_at at time zone ${timeZone}, 'YYYY-MM-DD') as day, null as line,
                 creator_id, sum(case when event = 'refund' then -net_minor else net_minor end)::numeric / 100 as amount,
                 0 as conversations
          from platform_sales
          where occurred_at >= ${from.toISOString()}::timestamptz and currency = 'EUR'
          group by 2, 4)
        select both_.*, c.display_name as name
        from (select * from calls union all select * from sold) both_
        left join creators c on c.id = both_.creator_id`);
      const parsed = z.array(ForecastReadSchema).parse(result.rows);
      const names = new Map<string, string>();
      for (const row of parsed)
        if (row.creator_id !== null && row.name !== null) names.set(row.creator_id, row.name);
      return {
        rows: parsed.flatMap((row) =>
          row.kind === 'call' && row.line !== null
            ? [
                {
                  day: row.day,
                  line: row.line,
                  creatorId: row.creator_id,
                  usd: Math.max(0, row.amount),
                  conversations: row.conversations,
                },
              ]
            : [],
        ),
        sales: parsed.flatMap((row) =>
          row.kind === 'sale' && row.creator_id !== null
            ? [{ day: row.day, creatorId: row.creator_id, netEur: row.amount }]
            : [],
        ),
        creatorNames: names,
      };
    },
    async quotaRefusedAt(provider) {
      // The provider's latest answered call bounds the episode; a refusal before it is over.
      const result = await adminDb.execute(sql`
        select min(created_at) as at from llm_calls
        where provider = ${provider} and status = 'quota_exhausted'
          and created_at > coalesce(
            (select max(created_at) from llm_calls where provider = ${provider} and status = 'ok'),
            '-infinity'::timestamptz)`);
      return z.object({ at: z.coerce.date().nullable() }).parse(result.rows[0] ?? { at: null }).at;
    },
  };
}

const EntryRowSchema = z.object({
  id: z.string(),
  provider: AiCreditProviderSchema,
  kind: AiCreditEntryKindSchema,
  amountMinor: z.number().int(),
  currency: AiCreditCurrencySchema,
  at: z.date(),
});

const entryColumns = {
  id: schema.aiCreditEntries.id,
  provider: schema.aiCreditEntries.provider,
  kind: schema.aiCreditEntries.kind,
  amountMinor: schema.aiCreditEntries.amountMinor,
  currency: schema.aiCreditEntries.currency,
  at: schema.aiCreditEntries.at,
};

function toEntry(row: unknown): AiCreditEntry {
  const parsed = EntryRowSchema.parse(row);
  return { ...parsed, at: parsed.at.toISOString() };
}

const sameEntry = (a: AiCreditEntry, b: AiCreditEntry, withDate: boolean): boolean =>
  a.provider === b.provider &&
  a.kind === b.kind &&
  a.amountMinor === b.amountMinor &&
  a.currency === b.currency &&
  (!withDate || Date.parse(a.at) === Date.parse(b.at));

/**
 * `ai_credit_entries` with the owner role (the agency's rows, RLS forced, `agency_only`): each line added or taken back
 * writes its `audit_log` line in the same transaction, with the amount, never a key.
 */
export function createPostgresCreditLedger(adminDb: Database): CreditLedger {
  return {
    async list() {
      const rows = await adminDb.select(entryColumns).from(schema.aiCreditEntries);
      return rows.map(toEntry);
    },
    add(entry, actor, datedByClient) {
      return withAdmin(adminDb, async (tx) => {
        const inserted = await tx
          .insert(schema.aiCreditEntries)
          .values({ ...entry, at: new Date(entry.at), createdBy: actor.userId })
          .onConflictDoNothing({ target: schema.aiCreditEntries.id })
          .returning(entryColumns);
        const [row] = inserted;
        if (row !== undefined) {
          await tx.insert(schema.auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId: actor.userId,
            action: 'ai_credit.add',
            entity: 'ai_credit_entry',
            entityId: entry.id,
            ip: actor.ip,
            details: {
              provider: entry.provider,
              kind: entry.kind,
              amountMinor: entry.amountMinor,
              currency: entry.currency,
            },
          });
          return { kind: 'created' as const, entry: toEntry(row) };
        }
        const [existing] = await tx
          .select(entryColumns)
          .from(schema.aiCreditEntries)
          .where(eq(schema.aiCreditEntries.id, entry.id));
        if (existing === undefined) return { kind: 'conflict' as const };
        const stored = toEntry(existing);
        return sameEntry(stored, entry, datedByClient)
          ? { kind: 'existing' as const, entry: stored }
          : { kind: 'conflict' as const };
      });
    },
    remove(id, actor) {
      return withAdmin(adminDb, async (tx) => {
        const removed = await tx
          .delete(schema.aiCreditEntries)
          .where(eq(schema.aiCreditEntries.id, id))
          .returning(entryColumns);
        const [row] = removed;
        if (row === undefined) return false;
        const entry = toEntry(row);
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: actor.userId,
          action: 'ai_credit.remove',
          entity: 'ai_credit_entry',
          entityId: id,
          ip: actor.ip,
          details: {
            provider: entry.provider,
            kind: entry.kind,
            amountMinor: entry.amountMinor,
            currency: entry.currency,
          },
        });
        return true;
      });
    },
  };
}

/**
 * `ai_credits_low` in the outbox (ADR 0020 § 3), as `budget_threshold_crossed`: the agency's, no creator, owner role.
 * One per provider, level and latest line of the ledger, under an advisory lock (the check may run twice at once). The
 * search starts at that line's instant, through `domain_events_created_idx`: no alert of its episode is older.
 */
export function createPostgresCreditAlerts(adminDb: Database): CreditAlerts {
  return {
    publish(input, since) {
      const payload = EVENT_PAYLOADS.ai_credits_low.parse(input);
      const key = `ai_credits_low:${payload.provider}:${payload.level}:${payload.entryId}`;
      return withAdmin(adminDb, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
        const seen = await tx.execute(sql`
          select 1 from domain_events
          where created_at >= ${since.toISOString()}::timestamptz and type = 'ai_credits_low' and correlation_id = ${key}
          limit 1`);
        if (seen.rows.length > 0) return false;
        await tx.insert(schema.domainEvents).values({
          id: newId(EventIdSchema),
          creatorId: null,
          type: 'ai_credits_low',
          payload,
          actor: 'system',
          correlationId: key,
          createdAt: new Date(),
        });
        return true;
      });
    },
    publishQuota(input) {
      const payload = EVENT_PAYLOADS.ai_quota_exhausted.parse(input);
      const key = `ai_quota_exhausted:${payload.provider}:${payload.refusedAt}`;
      // Published after its first refusal; a day of margin covers a clock of the database behind the server's.
      return withAdmin(adminDb, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
        const seen = await tx.execute(sql`
          select 1 from domain_events
          where created_at >= ${payload.refusedAt}::timestamptz - interval '1 day' and type = 'ai_quota_exhausted'
            and correlation_id = ${key}
          limit 1`);
        if (seen.rows.length > 0) return false;
        await tx.insert(schema.domainEvents).values({
          id: newId(EventIdSchema),
          creatorId: null,
          type: 'ai_quota_exhausted',
          payload,
          actor: 'system',
          correlationId: key,
          createdAt: new Date(),
        });
        return true;
      });
    },
  };
}
