import { PlatformSchema, SessionStateSchema } from '@impera/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  closedToCreator,
  createdAt,
  creatorReadsOnly,
  enumCheck,
  enumText,
  id,
  tenantPolicy,
  timestampTz,
} from './columns';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** The tenant. Out of RLS: it has no `creator_id`, the server reads it through `withAdmin`. */
export const creators = pgTable(
  'creators',
  {
    id: id(),
    displayName: text('display_name').notNull(),
    /**
     * `creatorNameKey(displayName)` (packages/contracts): her name without case, accents, invisible characters or
     * surrounding spaces. Unique: two creators never share a name (Charles, 28/10/2026), even when created at once.
     */
    nameKey: text('name_key').notNull(),
    timezone: text('timezone').notNull(),
    /** `CreatorSettings` (packages/contracts), camelCase keys. */
    settings: jsonb('settings').notNull().default({}),
    /** `AgentHours` (packages/contracts, P3-14), validated on read and write; `null` reads as `DEFAULT_AGENT_HOURS`. */
    agentHours: jsonb('agent_hours'),
    /**
     * Her photo, copied into the media storage (CRM-07, ADR 0069 § 3): the object's key there, never the platform's
     * address; `null` until one is copied.
     */
    avatarKey: text('avatar_key'),
    /**
     * When the owner archived her (ADR 0071 § 2): out of every list, the agent stopped for her by the code, her space
     * closed; nothing of hers is deleted. `null` while she is active; set back to `null` when she is reopened.
     */
    archivedAt: timestampTz('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('creators_name_key_unique').on(t.nameKey),
    check(
      'creators_avatar_key_check',
      sql`${t.avatarKey} is null or char_length(${t.avatarKey}) between 1 and 200`,
    ),
    check(
      'creators_agent_hours_object_check',
      sql`${t.agentHours} is null or jsonb_typeof(${t.agentHours}) = 'object'`,
    ),
  ],
);

export const platformAccounts = pgTable(
  'platform_accounts',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platform: enumText('platform').notNull(),
    handle: text('handle').notNull(),
    sessionState: enumText('session_state').notNull().default('none'),
    /** Captured platform session, AES-256-GCM (crypto.ts); never logged, never sent back to a client. */
    sessionCiphertext: bytea('session_ciphertext'),
    sessionUpdatedAt: timestampTz('session_updated_at'),
    lastPollAt: timestampTz('last_poll_at'),
    /**
     * The last vault sync that went through for this account (fiche vault-sync), changes or not: what « synchronisé à »
     * shows. Written by `connector.vault_sync` only; the media themselves are in `media_platform_refs`.
     */
    vaultSyncedAt: timestampTz('vault_synced_at'),
    /** Circuit breaker (connectors.md): failed polls in a row, and until when the account stays quiet. */
    consecutiveErrors: integer('consecutive_errors').notNull().default(0),
    pausedUntil: timestampTz('paused_until'),
    connectorConfig: jsonb('connector_config').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('platform_accounts', t.platform, PlatformSchema.options),
    enumCheck('platform_accounts', t.sessionState, SessionStateSchema.options),
    unique('platform_accounts_platform_handle_unique').on(t.platform, t.handle),
    /** The target of the planning's composite keys: a shift's account and creator always go together (EQ-02). */
    unique('platform_accounts_id_creator_unique').on(t.id, t.creatorId),
    index('platform_accounts_creator_idx').on(t.creatorId),
    tenantPolicy(t.creatorId),
    ...creatorReadsOnly(),
  ],
);

/** States of a `connector_sends` row: the outcome is unknown until the platform's message id is known. */
const CONNECTOR_SEND_STATES = ['pending', 'sent'] as const;

/**
 * The connector's own sends (reveal-connector-spec.md § 5, P2-03): a platform without a nonce (Reveal) makes two
 * messages of two sends, so each attempt is recorded before the call, under its idempotency key, and given the
 * platform's message id once known. A retry of a key still `pending` asks the platform (`verifySent`) before sending
 * again. Never the text: its fingerprint only. Written by the connector inside the creator's tenant; closed to her own
 * account; never deleted by the application.
 */
export const connectorSends = pgTable(
  'connector_sends',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platformAccountId: uuid('platform_account_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    platformConversationId: text('platform_conversation_id').notNull(),
    /** SHA-256 (hex) of the text, the script step and the media sent. */
    fingerprint: text('fingerprint').notNull(),
    /** The platform's script step of a step send, with which the fingerprint was computed; `null` otherwise. */
    scriptRef: text('script_ref'),
    state: enumText('state').notNull().default('pending'),
    attemptStartedAt: timestampTz('attempt_started_at').notNull(),
    platformMessageId: text('platform_message_id'),
    sentAt: timestampTz('sent_at'),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('connector_sends', t.state, CONNECTOR_SEND_STATES),
    check('connector_sends_fingerprint_check', sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`),
    check(
      'connector_sends_sent_check',
      sql`(${t.state} = 'sent') = (${t.platformMessageId} is not null) and (${t.platformMessageId} is null) = (${t.sentAt} is null)`,
    ),
    foreignKey({
      name: 'connector_sends_account_creator_fk',
      columns: [t.platformAccountId, t.creatorId],
      foreignColumns: [platformAccounts.id, platformAccounts.creatorId],
    }),
    unique('connector_sends_key_unique').on(t.platformAccountId, t.idempotencyKey),
    uniqueIndex('connector_sends_message_unique')
      .on(t.platformAccountId, t.platformMessageId)
      .where(sql`${t.platformMessageId} is not null`),
    index('connector_sends_conversation_idx').on(t.platformAccountId, t.platformConversationId),
    index('connector_sends_creator_idx').on(t.creatorId),
    tenantPolicy(t.creatorId),
    closedToCreator(),
  ],
);

/** Who did what in the dashboard (append-only, out of RLS: read by the owner through `withAdmin`). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    userId: text('user_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    details: jsonb('details').notNull().default({}),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_created_at_idx').on(t.createdAt)],
);
