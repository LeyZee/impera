import { LINK_PLACEMENTS, LINK_DESTINATION_MAX, LINK_USAGE_NOTE_MAX } from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
  type PgColumn,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, enumCheck, enumText, id, updatedAt } from './columns';
import { creators } from './tenancy';

/*
 * Her redirect links (INS-03; ADR 0080 § 4, ADR 0120 § 3, ADR 0121 § 1). They lived in the Telegram channel's setting
 * (`telegram_channels.config`); they have their own table because she reads them (« Mes liens ») and the click
 * readings hang on them. Written by the owner or an active manager through the server alone (admin role, after the
 * role check): no write policy. She reads her own links that are on and placed; the owner and an active manager read
 * every link of the creator at hand; a chatter reads none.
 */

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const isCreatorAccount: SQL = sql`current_setting('app.account_role', true) = 'creator'`;
const notCreatorAccount: SQL = sql`current_setting('app.account_role', true) is distinct from 'creator'`;
const hers = (creatorId: PgColumn): SQL => sql`${isCreatorAccount} and ${creatorId} = ${currentCreator}`;
const ofHerTeam = (creatorId: PgColumn): SQL =>
  sql`${notCreatorAccount} and ${currentScope} in ('owner', 'agency') and ${creatorId} = ${currentCreator}`;

export const redirectLinks = pgTable(
  'redirect_links',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    /** Where it leads, in the agency's words (ADR 0080 § 4.5). Empty: a post names no place. */
    destination: text('destination').notNull().default(''),
    /** Null until the agency says where the link is placed: nothing is attributed to it, and she does not see it. */
    placement: enumText('placement'),
    /** What it is for and when to use it, shown to her (ADR 0121 § 1). */
    usageNote: text('usage_note').notNull().default(''),
    enabled: boolean('enabled').notNull().default(true),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('redirect_links', t.placement, LINK_PLACEMENTS),
    check('redirect_links_name_check', sql`char_length(${t.name}) between 1 and 60`),
    check(
      'redirect_links_url_check',
      sql`${t.url} ~ '^https://[^[:space:]]+$' and char_length(${t.url}) <= 2048`,
    ),
    check(
      'redirect_links_destination_check',
      sql`char_length(${t.destination}) <= ${sql.raw(String(LINK_DESTINATION_MAX))}`,
    ),
    check(
      'redirect_links_usage_note_check',
      sql`char_length(${t.usageNote}) <= ${sql.raw(String(LINK_USAGE_NOTE_MAX))}`,
    ),
    unique('redirect_links_creator_name_unique').on(t.creatorId, t.name),
    index('redirect_links_creator_idx').on(t.creatorId),
    pgPolicy('creator_read', {
      for: 'select',
      using: sql`${hers(t.creatorId)} and ${t.enabled} and ${t.placement} is not null`,
    }),
    pgPolicy('team_read', { for: 'select', using: ofHerTeam(t.creatorId) }),
  ],
);
