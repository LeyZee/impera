import {
  AI_CREDIT_MAX_MINOR,
  AiCreditCurrencySchema,
  AiCreditEntryKindSchema,
  AiCreditProviderSchema,
  CurrencySchema,
  LlmPurposeSchema,
  LlmRoleSchema,
} from '@impera/contracts';
import { sql } from 'drizzle-orm';
import { bigint, boolean, char, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { user } from './auth';
import {
  agencyOnly,
  closedToCreator,
  createdAt,
  enumCheck,
  enumText,
  id,
  tenantPolicy,
  timestampTz,
} from './columns';
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
    /** What the call was for (ADR 0060 § 7): the trend watch is summed apart, under its own cap. */
    purpose: enumText('purpose').notNull().default('chatting'),
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
    enumCheck('llm_calls', t.purpose, LlmPurposeSchema.options),
    enumCheck('llm_calls', t.status, LLM_CALL_STATUSES),
    enumCheck('llm_calls', t.currency, CurrencySchema.options),
    index('llm_calls_creator_created_idx').on(t.creatorId, t.createdAt),
    tenantPolicy(t.creatorId),
    closedToCreator(),
  ],
);

/**
 * The AI credits ledger (ADR 0091 § 3): each top-up the owner writes down, or the balance he reads in a provider's
 * console. The agency's, out of tenancy: RLS forced, one permissive policy for every path but a creator's account.
 * A line is added or taken back whole (a typo), never edited.
 */
export const aiCreditEntries = pgTable(
  'ai_credit_entries',
  {
    id: id(),
    provider: enumText('provider').notNull(),
    kind: enumText('kind').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    at: timestampTz('at').notNull(),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('ai_credit_entries', t.provider, AiCreditProviderSchema.options),
    enumCheck('ai_credit_entries', t.kind, AiCreditEntryKindSchema.options),
    enumCheck('ai_credit_entries', t.currency, AiCreditCurrencySchema.options),
    check(
      'ai_credit_entries_amount_check',
      sql`${t.amountMinor} between 0 and ${sql.raw(String(AI_CREDIT_MAX_MINOR))} and (${t.kind} = 'balance' or ${t.amountMinor} > 0)`,
    ),
    index('ai_credit_entries_provider_at_idx').on(t.provider, t.at),
    agencyOnly(),
  ],
);
