import { CurrencySchema, LlmRoleSchema } from '@nirvana/contracts';
import { bigint, boolean, char, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { closedToCreator, createdAt, enumCheck, enumText, id, tenantPolicy } from './columns';
import { conversations } from './conversations';
import { creators } from './tenancy';

/** Journal of LLM calls (packages/llm): metadata only, never the prompt or the answer. */
/** The gateway's outcomes (`CallOutcome` in packages/llm): supervision reads them per provider and role. */
export const LLM_CALL_STATUSES = [
  'ok',
  'invalid_output',
  'refused',
  'timeout',
  'rate_limited',
  'auth',
  'unavailable',
  'missing_key',
  'unknown_model',
  'unsupported_input',
  'prompt_leak',
  'error',
] as const;

export const llmCalls = pgTable(
  'llm_calls',
  {
    id: id(),
    creatorId: uuid('creator_id').references(() => creators.id),
    role: enumText('role').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptHash: text('prompt_hash').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costMinor: integer('cost_minor'),
    currency: char('currency', { length: 3 }),
    latencyMs: integer('latency_ms').notNull(),
    status: enumText('status').notNull(),
    conversationId: uuid('conversation_id').references(() => conversations.id),
    /** No foreign key: the calls happen before the draft is written, and a held answer writes none. */
    draftId: uuid('draft_id'),
    /** Exact cost in millionths of a dollar: one call costs a fraction of a cent (`cost_minor` rounds it away). */
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }),
    isFallback: boolean('is_fallback').notNull().default(false),
    traceId: text('trace_id'),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('llm_calls', t.role, LlmRoleSchema.options),
    enumCheck('llm_calls', t.status, LLM_CALL_STATUSES),
    enumCheck('llm_calls', t.currency, CurrencySchema.options),
    index('llm_calls_creator_created_idx').on(t.creatorId, t.createdAt),
    tenantPolicy(t.creatorId),
    closedToCreator(),
  ],
);
