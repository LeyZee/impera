import { CREATOR_MESSAGE_TEXT_MAX } from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { check, index, pgPolicy, pgTable, text, uuid, type PgColumn } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, timestampTz } from './columns';
import { creators } from './tenancy';

/**
 * « Écrire à l'agence » (Charles, 21/11, contracts `creator-messages.ts`): what she writes to the agency, and the owner's
 * answer. Written by her in her own account (`withCreatorAccount`); read by her owner and an active manager
 * (`withTenantMember`, scope owner or agency); answered by the owner alone, once. Never deleted.
 */

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const isCreatorAccount: SQL = sql`current_setting('app.account_role', true) = 'creator'`;
const notCreatorAccount: SQL = sql`current_setting('app.account_role', true) is distinct from 'creator'`;
const hers = (creatorId: PgColumn): SQL => sql`${isCreatorAccount} and ${creatorId} = ${currentCreator}`;
const ofHerTeam = (creatorId: PgColumn): SQL =>
  sql`${notCreatorAccount} and ${currentScope} in ('owner', 'agency') and ${creatorId} = ${currentCreator}`;
const ofHerOwner = (creatorId: PgColumn): SQL =>
  sql`${notCreatorAccount} and ${currentScope} = 'owner' and ${creatorId} = ${currentCreator}`;

export const creatorMessages = pgTable(
  'creator_messages',
  {
    /** Chosen by her phone: a replay writes nothing twice. */
    id: uuid('id').primaryKey(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    answer: text('answer'),
    answeredBy: text('answered_by').references(() => user.id),
    answeredAt: timestampTz('answered_at'),
  },
  (t) => [
    index('creator_messages_creator_created_idx').on(t.creatorId, t.createdAt),
    check('creator_messages_kind_check', sql`${t.kind} in ('question', 'idea', 'worry')`),
    check(
      'creator_messages_body_check',
      sql`char_length(${t.body}) between 1 and ${sql.raw(String(CREATOR_MESSAGE_TEXT_MAX))}`,
    ),
    check(
      'creator_messages_answer_check',
      sql`char_length(${t.answer}) between 1 and ${sql.raw(String(CREATOR_MESSAGE_TEXT_MAX))}`,
    ),
    check(
      'creator_messages_answered_check',
      sql`(${t.answer} is null) = (${t.answeredBy} is null) and (${t.answer} is null) = (${t.answeredAt} is null)`,
    ),
    pgPolicy('creator_read', { for: 'select', using: hers(t.creatorId) }),
    pgPolicy('creator_insert', {
      for: 'insert',
      withCheck: sql`${hers(t.creatorId)} and ${t.createdBy} = ${currentUser} and ${t.answer} is null`,
    }),
    pgPolicy('team_read', { for: 'select', using: ofHerTeam(t.creatorId) }),
    // The owner answers, by his own name, once: an answered message is never rewritten.
    pgPolicy('owner_answer', {
      for: 'update',
      using: sql`${ofHerOwner(t.creatorId)} and ${t.answer} is null`,
      withCheck: sql`${ofHerOwner(t.creatorId)} and ${t.answeredBy} = ${currentUser}`,
    }),
  ],
);
