import { LINK_PLACEMENTS, LINK_DESTINATION_MAX, LINK_USAGE_NOTE_MAX } from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
  type PgColumn,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { closedToCreator, createdAt, enumCheck, enumText, id, timestampTz, updatedAt } from './columns';
import { creators } from './tenancy';

/*
 * Her redirect links (INS-03; ADR 0080 § 4, ADR 0120 § 3, ADR 0121 § 1). They lived in the Telegram channel's setting
 * (`telegram_channels.config`); they have their own table because she reads them (« Mes liens ») and the click
 * readings hang on them. Written by the owner or an active manager through the server alone (admin role, after the
 * role check): no write policy. She reads her own links that are on and placed; the owner and an active manager read
 * every link of the creator at hand; a chatter reads none.
 *
 * `service_ref` (INS-02 lot e2) is how the redirect service names the link, kept once the owner attached it: the one
 * column written under the app role, by the owner alone, in the creator at hand (`owner_attach`, and a grant on that
 * column only). It never comes from a browser: the server reads it at the service, by the link's own address. One
 * link of the service belongs to one creator: unique over the whole table.
 */

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const isCreatorAccount: SQL = sql`current_setting('app.account_role', true) = 'creator'`;
const notCreatorAccount: SQL = sql`current_setting('app.account_role', true) is distinct from 'creator'`;
const hers = (creatorId: PgColumn): SQL => sql`${isCreatorAccount} and ${creatorId} = ${currentCreator}`;
const ofHerTeam = (creatorId: PgColumn): SQL =>
  sql`${notCreatorAccount} and ${currentScope} in ('owner', 'agency') and ${creatorId} = ${currentCreator}`;
const ofHerOwner = (creatorId: PgColumn): SQL =>
  sql`${notCreatorAccount} and ${currentScope} = 'owner' and ${creatorId} = ${currentCreator}`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
/** The hourly reading of her links, in the creator it writes (`withTenantJob(…, 'link_hours', …)`). */
const linkHoursJob = (creatorId: PgColumn): SQL =>
  sql`${creatorId} = ${currentCreator} and nullif(current_setting('app.job', true), '') = 'link_hours'`;

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
    /** How the redirect service names it; null until the owner attaches it, and again when its address changes. */
    serviceRef: text('service_ref'),
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
    check(
      'redirect_links_service_ref_check',
      sql`${t.serviceRef} is null or ${t.serviceRef} ~ '^[a-z]{2,8}_[0-9a-f]{16,40}$'`,
    ),
    unique('redirect_links_creator_name_unique').on(t.creatorId, t.name),
    unique('redirect_links_service_ref_unique').on(t.serviceRef),
    // What an hour kept points at: the link and its creator together, so an hour never carries another's creator.
    unique('redirect_links_id_creator_unique').on(t.id, t.creatorId),
    index('redirect_links_creator_idx').on(t.creatorId),
    pgPolicy('creator_read', {
      for: 'select',
      using: sql`${hers(t.creatorId)} and ${t.enabled} and ${t.placement} is not null`,
    }),
    pgPolicy('team_read', { for: 'select', using: ofHerTeam(t.creatorId) }),
    pgPolicy('owner_attach', {
      for: 'update',
      using: ofHerOwner(t.creatorId),
      withCheck: ofHerOwner(t.creatorId),
    }),
    // The hourly reading learns which links of hers to read, in her own transaction.
    pgPolicy('job_read', { for: 'select', using: linkHoursJob(t.creatorId) }),
  ],
);

/**
 * The hours kept of one of her redirect links (ADR 0120 § 3, INS-02 lot e2): page views without the robots, clicks,
 * and the number of robots beside. Totals only: nothing of a visitor. One row per link and per hour, UTC, zero
 * included: an hour that is absent was not read. While an hour is open a new reading replaces it; a reading made
 * after its end closes it, and a closed hour is never written again (the job's update policy refuses it).
 *
 * Written by the hourly job alone, under the app role, one creator at a time (`withTenantJob`); nobody removes a
 * row. Read by the owner, or an active manager with her on his list; closed to a creator's own account.
 */
export const redirectLinkHours = pgTable(
  'redirect_link_hours',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'cascade' }),
    linkId: uuid('link_id').notNull(),
    hour: timestampTz('hour').notNull(),
    pageviews: integer('pageviews').notNull(),
    clicks: integer('clicks').notNull(),
    robots: integer('robots').notNull(),
    closed: boolean('closed').notNull(),
    readAt: timestampTz('read_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'redirect_link_hours_link_creator_fk',
      columns: [t.linkId, t.creatorId],
      foreignColumns: [redirectLinks.id, redirectLinks.creatorId],
    }).onDelete('cascade'),
    unique('redirect_link_hours_link_hour_unique').on(t.linkId, t.hour),
    index('redirect_link_hours_creator_hour_idx').on(t.creatorId, t.hour),
    check('redirect_link_hours_hour_check', sql`extract(epoch from ${t.hour})::bigint % 3600 = 0`),
    check(
      'redirect_link_hours_counts_check',
      sql`${t.pageviews} >= 0 and ${t.clicks} >= 0 and ${t.robots} >= 0`,
    ),
    // Closed by a reading made after the hour ended, and by no other.
    check(
      'redirect_link_hours_closed_check',
      sql`not ${t.closed} or ${t.readAt} >= ${t.hour} + interval '1 hour'`,
    ),
    pgPolicy('hours_read', {
      for: 'select',
      using: sql`${notCreatorAccount} and ${t.creatorId} = ${currentCreator} and (${currentScope} = 'owner' or (${currentScope} = 'agency' and exists (select 1 from "user" u where u.id = ${currentUser} and ${t.creatorId} = any(u.creator_ids))))`,
    }),
    pgPolicy('job_read', { for: 'select', using: linkHoursJob(t.creatorId) }),
    pgPolicy('job_insert', { for: 'insert', withCheck: linkHoursJob(t.creatorId) }),
    // The freeze lives here: an hour once closed matches no row the job may change.
    pgPolicy('job_update', {
      for: 'update',
      using: sql`${linkHoursJob(t.creatorId)} and not ${t.closed}`,
      withCheck: linkHoursJob(t.creatorId),
    }),
    closedToCreator(),
  ],
);
