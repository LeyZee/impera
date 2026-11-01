import { PlatformSchema, SessionStateSchema } from '@nirvana/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, enumCheck, enumText, id, tenantPolicy, timestampTz } from './columns';

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
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('creators_name_key_unique').on(t.nameKey),
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
