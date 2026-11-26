import { AGENCY_PRIVATE_STYLE_MAX, AGENCY_PUBLIC_STYLE_MAX } from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { boolean, check, integer, jsonb, pgPolicy, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { closedToCreator, createdAt, id, timestampTz } from './columns';

const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const isOwner: SQL = sql`nullif(current_setting('app.team_scope', true), '') = 'owner'`;

/**
 * The agency's base style (ADR 0171): its versions, each saved by the owner and never active at birth, one active at a
 * time, activated by the owner. The owner alone reads and writes them (`withMember`); the agent reads the active one on
 * the service connection. The app may only set the activation's columns (column grant, migration); never deleted.
 * Closed to a creator's account. Its texts are the agency's, never the repo's.
 */
export const agencyStyles = pgTable(
  'agency_styles',
  {
    id: id(),
    version: integer('version').notNull(),
    privateStyle: text('private_style').notNull(),
    publicStyle: text('public_style').notNull(),
    /** `VoiceFormSettings`, read through its schema: absent rules are the code's. */
    form: jsonb('form').notNull().default({}),
    isActive: boolean('is_active').notNull().default(false),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    activatedBy: text('activated_by').references(() => user.id),
    activatedAt: timestampTz('activated_at'),
  },
  (t) => [
    uniqueIndex('agency_styles_version_unique').on(t.version),
    uniqueIndex('agency_styles_one_active')
      .on(t.isActive)
      .where(sql`${t.isActive}`),
    check('agency_styles_version_check', sql`${t.version} > 0`),
    check(
      'agency_styles_private_style_check',
      sql`char_length(${t.privateStyle}) <= ${sql.raw(String(AGENCY_PRIVATE_STYLE_MAX))}`,
    ),
    check(
      'agency_styles_public_style_check',
      sql`char_length(${t.publicStyle}) <= ${sql.raw(String(AGENCY_PUBLIC_STYLE_MAX))}`,
    ),
    check('agency_styles_form_check', sql`jsonb_typeof(${t.form}) = 'object'`),
    check(
      'agency_styles_activated_check',
      sql`not ${t.isActive} or (${t.activatedAt} is not null and ${t.activatedBy} is not null)`,
    ),
    pgPolicy('owner_read', { for: 'select', using: isOwner }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${isOwner} and ${t.createdBy} = ${currentUser} and not ${t.isActive}`,
    }),
    pgPolicy('owner_activate', {
      for: 'update',
      using: isOwner,
      withCheck: sql`${isOwner} and (not ${t.isActive} or ${t.activatedBy} = ${currentUser})`,
    }),
    closedToCreator(),
  ],
);
