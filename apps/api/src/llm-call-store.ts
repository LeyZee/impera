import { LlmCallIdSchema, LlmPurposeSchema, newId } from '@impera/contracts';
import { schema, sql, type Database } from '@impera/db';
import { CALL_OUTCOMES, type LlmCallRecord, type LlmCallStore } from '@impera/llm';
import { z } from 'zod';

const RowSchema = z.object({
  created_at: z.coerce.date(),
  creator_id: z.string().nullable(),
  role: z.enum(['voice', 'brain', 'sense', 'judge']),
  purpose: LlmPurposeSchema,
  provider: z.enum(['xai', 'mistral', 'venice', 'google']),
  model: z.string(),
  prompt_hash: z.string(),
  status: z.enum(CALL_OUTCOMES).catch('error'),
  latency_ms: z.number(),
  is_fallback: z.boolean(),
  input_tokens: z.number().nullable(),
  output_tokens: z.number().nullable(),
  // `bigint` comes back as a string.
  cost_micro_usd: z.coerce.number().nullable(),
  conversation_id: z.string().nullable(),
  draft_id: z.string().nullable(),
});

function toRecord(row: z.infer<typeof RowSchema>): LlmCallRecord {
  return {
    at: row.created_at,
    role: row.role,
    // `chatting` stays implicit, as the gateway writes it.
    ...(row.purpose === 'chatting' ? {} : { purpose: row.purpose }),
    provider: row.provider,
    model: row.model,
    promptHash: row.prompt_hash,
    outcome: row.status,
    latencyMs: row.latency_ms,
    isFallback: row.is_fallback,
    ...(row.creator_id === null ? {} : { creatorId: row.creator_id }),
    ...(row.input_tokens === null ? {} : { inputTokens: row.input_tokens }),
    ...(row.output_tokens === null ? {} : { outputTokens: row.output_tokens }),
    ...(row.cost_micro_usd === null ? {} : { costUsd: row.cost_micro_usd / 1_000_000 }),
    ...(row.conversation_id === null ? {} : { conversationId: row.conversation_id }),
    ...(row.draft_id === null ? {} : { draftId: row.draft_id }),
  };
}

/**
 * `llm_calls` through the owner role: the journal is the app's, not a tenant's (a playground call has no creator),
 * and the start-up read spans every creator. Never holds a prompt nor an answer (the record has none).
 */
export function createDrizzleLlmCallStore(adminDb: Database): LlmCallStore {
  return {
    async insert(record) {
      await adminDb.insert(schema.llmCalls).values({
        id: newId(LlmCallIdSchema),
        creatorId: record.creatorId ?? null,
        role: record.role,
        purpose: record.purpose ?? 'chatting',
        provider: record.provider,
        model: record.model,
        promptHash: record.promptHash,
        inputTokens: record.inputTokens ?? null,
        outputTokens: record.outputTokens ?? null,
        // Exact to the millionth of a dollar: one call costs a fraction of a cent.
        costMicroUsd: record.costUsd === undefined ? null : Math.round(record.costUsd * 1_000_000),
        latencyMs: Math.round(record.latencyMs),
        status: record.outcome,
        isFallback: record.isFallback,
        conversationId: record.conversationId ?? null,
        draftId: record.draftId ?? null,
        createdAt: record.at,
      });
    },
    async listSince(from) {
      const result = await adminDb.execute(sql`
        select created_at, creator_id, role, purpose, provider, model, prompt_hash, status, latency_ms, is_fallback,
               input_tokens, output_tokens, cost_micro_usd, conversation_id, draft_id
        from llm_calls where created_at >= ${from.toISOString()}::timestamptz order by created_at`);
      return z.array(RowSchema).parse(result.rows).map(toRecord);
    },
  };
}
