import {
  PERSONA_CORRECTION_STATES,
  PersonaCorrectionSectionSchema,
  SOCIAL_ACCOUNT_PLATFORMS,
  SOCIAL_ACCOUNT_USAGES,
  SOCIAL_ACCOUNT_USERNAME_MAX,
  SOCIAL_ACCOUNTS_MAX,
} from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
  type PgColumn,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import {
  closedToCreator,
  createdAt,
  enumCheck,
  enumText,
  id,
  tenantPolicy,
  timestampTz,
  updatedAt,
} from './columns';
import { creators } from './tenancy';

/** Module `persona` (ADR 0010): each loaded version, validated by `PersonaSchema`; one active per creator. */
export const personaVersions = pgTable(
  'persona_versions',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    version: text('version').notNull(),
    sourcePath: text('source_path').notNull(),
    content: jsonb('content').notNull(),
    contentHash: text('content_hash').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    activatedAt: timestampTz('activated_at'),
    createdBy: text('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('persona_versions_creator_version_unique').on(t.creatorId, t.version),
    uniqueIndex('persona_versions_one_active')
      .on(t.creatorId)
      .where(sql`${t.isActive}`),
    tenantPolicy(t.creatorId),
  ],
);

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const isCreatorAccount: SQL = sql`current_setting('app.account_role', true) = 'creator'`;
const notCreatorAccount: SQL = sql`current_setting('app.account_role', true) is distinct from 'creator'`;
const hers = (creatorId: PgColumn): SQL => sql`${isCreatorAccount} and ${creatorId} = ${currentCreator}`;
const ofHerTeam = (creatorId: PgColumn): SQL =>
  sql`${notCreatorAccount} and ${currentScope} in ('owner', 'agency') and ${creatorId} = ${currentCreator}`;

/**
 * A correction of her sheet she proposed (recette CREA-01 b, contracts `PersonaCorrection`). She writes it from her own
 * account (`withCreatorAccount`) and reads hers; the owner and an active manager read them (`withTenantMember`), the
 * owner alone marks one handled, as he alone changes her persona. Never deleted.
 */
export const personaCorrections = pgTable(
  'persona_corrections',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    section: enumText('section').notNull(),
    text: text('text').notNull(),
    state: enumText('state').notNull().default('open'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    doneBy: text('done_by').references(() => user.id),
    doneAt: timestampTz('done_at'),
  },
  (t) => [
    // Both sheets' sections: a stored correction keeps its own (ADR 0079 § 6).
    enumCheck('persona_corrections', t.section, PersonaCorrectionSectionSchema.options),
    enumCheck('persona_corrections', t.state, PERSONA_CORRECTION_STATES),
    check('persona_corrections_text_check', sql`char_length(${t.text}) between 1 and 600`),
    check(
      'persona_corrections_done_check',
      sql`(${t.state} = 'done') = (${t.doneAt} is not null and ${t.doneBy} is not null)`,
    ),
    index('persona_corrections_creator_idx').on(t.creatorId, t.createdAt),
    pgPolicy('creator_read', { for: 'select', using: hers(t.creatorId) }),
    pgPolicy('creator_insert', {
      for: 'insert',
      withCheck: sql`${hers(t.creatorId)} and ${t.createdBy} = ${currentUser} and ${t.state} = 'open'`,
    }),
    pgPolicy('team_read', { for: 'select', using: ofHerTeam(t.creatorId) }),
    pgPolicy('owner_update', {
      for: 'update',
      using: sql`${ofHerTeam(t.creatorId)} and ${currentScope} = 'owner'`,
      withCheck: sql`${ofHerTeam(t.creatorId)} and ${currentScope} = 'owner' and ${t.doneBy} = ${currentUser}`,
    }),
  ],
);

/**
 * « Ses comptes » (ADR 0143 § C): her accounts on other platforms, with their use and « l'agent peut le donner », off
 * until the owner turns it on. Real data, never in the repository. Read in her tenant (the owner, a manager, the jobs);
 * written by the owner alone (`withTenantMember`, scope `owner`), each change in `audit_log`; closed to her account.
 */
export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platform: enumText('platform').notNull(),
    username: text('username').notNull(),
    usage: enumText('usage').notNull(),
    agentMayShare: boolean('agent_may_share').notNull().default(false),
    position: smallint('position').notNull(),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('social_accounts', t.platform, SOCIAL_ACCOUNT_PLATFORMS),
    enumCheck('social_accounts', t.usage, SOCIAL_ACCOUNT_USAGES),
    check(
      'social_accounts_username_check',
      sql`char_length(${t.username}) between 1 and ${sql.raw(String(SOCIAL_ACCOUNT_USERNAME_MAX))} and ${t.username} ~ '^[[:alnum:]._-]+$'`,
    ),
    check(
      'social_accounts_position_check',
      sql`${t.position} >= 0 and ${t.position} < ${sql.raw(String(SOCIAL_ACCOUNTS_MAX))}`,
    ),
    uniqueIndex('social_accounts_creator_account_unique').on(
      t.creatorId,
      t.platform,
      sql`lower(${t.username})`,
    ),
    index('social_accounts_creator_idx').on(t.creatorId, t.position),
    // Her team (the owner, an active manager) or a job (no scope): never a chatter's own scope.
    pgPolicy('team_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and (${currentScope} is null or ${currentScope} in ('owner', 'agency'))`,
    }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${currentScope} = 'owner' and ${t.updatedBy} = ${currentUser}`,
    }),
    pgPolicy('owner_update', {
      for: 'update',
      using: sql`${t.creatorId} = ${currentCreator} and ${currentScope} = 'owner'`,
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${currentScope} = 'owner' and ${t.updatedBy} = ${currentUser}`,
    }),
    pgPolicy('owner_delete', {
      for: 'delete',
      using: sql`${t.creatorId} = ${currentCreator} and ${currentScope} = 'owner'`,
    }),
    closedToCreator(),
  ],
);
