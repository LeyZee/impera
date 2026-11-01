import {
  ConversationModeSchema,
  ConversationStateSchema,
  CurrencySchema,
  DESIRE_SCORE_MAX,
  DESIRE_SCORE_MIN,
  DesireBandSchema,
  DraftStatusSchema,
  EVENT_TYPES,
  MessageAuthorSchema,
  MessageDirectionSchema,
  type ExternalMedia,
} from '@nirvana/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, enumCheck, enumText, id, tenantPolicy, timestampTz, updatedAt } from './columns';
import { fans } from './fans';
import { personaVersions } from './persona';
import { creators, platformAccounts } from './tenancy';

/**
 * Module `conversations`. Every change to `conversations`, `drafts` and `messages` goes through a function that
 * writes the matching `conversation_events` row in the same transaction (ADR 0007).
 */

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platformAccountId: uuid('platform_account_id')
      .notNull()
      .references(() => platformAccounts.id),
    fanId: uuid('fan_id')
      .notNull()
      .references(() => fans.id),
    platformConversationId: text('platform_conversation_id').notNull(),
    state: enumText('state').notNull().default('idle'),
    mode: enumText('mode').notNull().default('copilot'),
    lastInboundAt: timestampTz('last_inbound_at'),
    lastOutboundAt: timestampTz('last_outbound_at'),
    unreadCount: integer('unread_count').notNull().default(0),
    cooldowns: jsonb('cooldowns').notNull().default({}),
    activeScriptRunId: uuid('active_script_run_id'),
    /**
     * The team member this conversation is routed to (a `sale` handoff, EQ-08): a member whose scope is `self` reads
     * and acts on a conversation of his creators only through this column (ADR 0024). Null: routed to nobody.
     */
    routedToUserId: text('routed_to_user_id').references(() => user.id),
    /**
     * The fan's desire score as of its last change (`desire_scored`, P3-12), its band, and when it was computed: the
     * engine lets it cool from then on. Null until the engine first scores him.
     */
    desireScore: integer('desire_score'),
    desireBand: enumText('desire_band'),
    desireAt: timestampTz('desire_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('conversations', t.state, ConversationStateSchema.options),
    enumCheck('conversations', t.mode, ConversationModeSchema.options),
    enumCheck('conversations', t.desireBand, DesireBandSchema.options),
    check(
      'conversations_desire_score_check',
      sql`${t.desireScore} between ${sql.raw(String(DESIRE_SCORE_MIN))} and ${sql.raw(String(DESIRE_SCORE_MAX))}`,
    ),
    check(
      'conversations_desire_together_check',
      sql`(${t.desireScore} is null) = (${t.desireBand} is null) and (${t.desireScore} is null) = (${t.desireAt} is null)`,
    ),
    unique('conversations_platform_conversation_unique').on(t.platformAccountId, t.platformConversationId),
    index('conversations_account_state_idx').on(t.platformAccountId, t.state),
    index('conversations_creator_last_inbound_idx').on(t.creatorId, t.lastInboundAt.desc()),
    index('conversations_routed_to_idx')
      .on(t.routedToUserId, t.updatedAt.desc())
      .where(sql`${t.routedToUserId} is not null`),
    tenantPolicy(t.creatorId),
  ],
);

export const drafts = pgTable(
  'drafts',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    status: enumText('status').notNull().default('pending'),
    /** The brain's output. */
    brief: jsonb('brief'),
    bubbles: text('bubbles')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** After a human edit. */
    finalBubbles: text('final_bubbles').array(),
    personaVersionId: uuid('persona_version_id').references(() => personaVersions.id),
    promptHashes: jsonb('prompt_hashes').notNull().default({}),
    policyTrace: jsonb('policy_trace').notNull().default({}),
    guardTrace: jsonb('guard_trace').notNull().default({}),
    decidedBy: text('decided_by'),
    decidedAt: timestampTz('decided_at'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('drafts', t.status, DraftStatusSchema.options),
    unique('drafts_idempotency_key_unique').on(t.idempotencyKey),
    index('drafts_conversation_idx').on(t.conversationId, t.createdAt.desc()),
    tenantPolicy(t.creatorId),
  ],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    /** Denormalised so the platform message id is unique per account (idempotent ingestion). */
    platformAccountId: uuid('platform_account_id')
      .notNull()
      .references(() => platformAccounts.id),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    platformMessageId: text('platform_message_id').notNull(),
    direction: enumText('direction').notNull(),
    author: enumText('author').notNull(),
    text: text('text').notNull().default(''),
    mediaIds: uuid('media_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /**
     * The media as the platform listed them on the message (kind, reference, locked), kept from ingestion on: the
     * engine must know a fan sent a photo even before the media module stores it (`media_ids`). Data, never a URL.
     */
    platformMedia: jsonb('platform_media').$type<ExternalMedia[]>().notNull().default([]),
    priceMinor: integer('price_minor'),
    currency: char('currency', { length: 3 }),
    isPaid: boolean('is_paid').notNull().default(false),
    platformCreatedAt: timestampTz('platform_created_at').notNull(),
    createdAt: createdAt(),
    draftId: uuid('draft_id').references((): AnyPgColumn => drafts.id),
  },
  (t) => [
    enumCheck('messages', t.direction, MessageDirectionSchema.options),
    enumCheck('messages', t.author, MessageAuthorSchema.options),
    enumCheck('messages', t.currency, CurrencySchema.options),
    // A price is what a fan pays, never a credit (the connectors' contracts already refuse one below zero).
    check('messages_price_minor_check', sql`${t.priceMinor} is null or ${t.priceMinor} >= 0`),
    unique('messages_platform_message_unique').on(t.platformAccountId, t.platformMessageId),
    index('messages_conversation_created_idx').on(t.conversationId, t.platformCreatedAt.desc()),
    tenantPolicy(t.creatorId),
  ],
);

/** The conversation's journal (ADR 0007): append-only, ordered by `seq`, enforced by a trigger. */
export const conversationEvents = pgTable(
  'conversation_events',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    type: enumText('type').notNull(),
    payload: jsonb('payload').notNull(),
    /** `system | ai | fan | human:<userId>` */
    actor: text('actor').notNull(),
    correlationId: text('correlation_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('conversation_events', t.type, EVENT_TYPES),
    unique('conversation_events_seq_unique').on(t.conversationId, t.seq),
    index('conversation_events_type_created_idx').on(t.type, t.createdAt),
    tenantPolicy(t.creatorId),
  ],
);

/**
 * The blind tests with the creator (ADR 0019): one per run, recorded by the owner, for the voice version the server
 * had then. The latest test of a version decides whether it passed. Append-only (migration 0008).
 */
export const blindTests = pgTable(
  'blind_tests',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    voicePrompt: text('voice_prompt').notNull(),
    voiceModel: text('voice_model').notNull(),
    /** The persona active when the test was recorded: part of the version proved (ADR 0022); null without one. */
    personaVersionId: uuid('persona_version_id').references(() => personaVersions.id),
    /** The rate « sans retouche » in tenths of a percent (800 = 80 %): no float on a threshold. */
    ratePerMille: integer('rate_per_mille').notNull(),
    recordedBy: text('recorded_by').notNull(),
    recordedAt: timestampTz('recorded_at').notNull().defaultNow(),
  },
  (t) => [
    check('blind_tests_rate_check', sql`${t.ratePerMille} between 0 and 1000`),
    index('blind_tests_version_idx').on(
      t.creatorId,
      t.voicePrompt,
      t.voiceModel,
      t.personaVersionId,
      t.recordedAt.desc(),
    ),
    tenantPolicy(t.creatorId),
  ],
);
