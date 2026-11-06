import { PERSONA_CORRECTION_SECTIONS, PERSONA_CORRECTION_STATES } from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type PgColumn,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, enumCheck, enumText, id, tenantPolicy, timestampTz } from './columns';
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
    enumCheck('persona_corrections', t.section, PERSONA_CORRECTION_SECTIONS),
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
