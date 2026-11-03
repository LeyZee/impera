import {
  CONTENT_IDEA_STATES,
  DROP_CATEGORIES,
  TREND_FORMATS,
  TREND_SIGNAL_KINDS,
  TREND_SIGNAL_SOURCES,
} from '@nirvana/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, enumCheck, enumText, id, timestampTz, updatedAt } from './columns';
import { creators } from './tenancy';

/*
 * The trend watch (ADR 0060, VEI-01, contracts `trends.ts`). Read and decided by the owner and an active manager inside
 * `withTenantMember`; never read by a chatter nor by the creator, who adds a pasted link of hers and nothing else
 * (ADR 0042: she never sees the AI). The jobs (signals of Grok, of her statistics, of the reference accounts, of the
 * readings; the morning ideas) write through `withAdmin`.
 */

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const readsTeam: SQL = sql`${currentScope} in ('owner', 'agency')`;
const anyMember: SQL = sql`${currentScope} is not null`;
const isCreatorAccount: SQL = sql`current_setting('app.account_role', true) = 'creator'`;
const notCreatorAccount: SQL = sql`current_setting('app.account_role', true) is distinct from 'creator'`;

/**
 * A trend signal (ADR 0060 § 2): a source, a short text, a facultative link and figures, a lifetime. `creator_id` null
 * is a signal for the whole agency (Grok). A pasted link is unique per creator: pasting it again adds nothing. A signal
 * born of a reading points to it, once. Nobody changes or removes one but the jobs: it simply expires.
 */
export const trendSignals = pgTable(
  'trend_signals',
  {
    id: id(),
    creatorId: uuid('creator_id').references(() => creators.id),
    source: enumText('source').notNull(),
    kind: enumText('kind').notNull(),
    text: text('text').notNull(),
    url: text('url'),
    format: enumText('format'),
    views: integer('views'),
    likes: integer('likes'),
    comments: integer('comments'),
    readingId: uuid('reading_id').references(() => trendReadings.id),
    createdBy: text('created_by').references(() => user.id),
    observedAt: timestampTz('observed_at').notNull(),
    expiresAt: timestampTz('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('trend_signals', t.source, TREND_SIGNAL_SOURCES),
    enumCheck('trend_signals', t.kind, TREND_SIGNAL_KINDS),
    check(
      'trend_signals_format_check',
      sql`${t.format} is null or ${t.format} in (${sql.raw(TREND_FORMATS.map((f) => `'${f}'`).join(', '))})`,
    ),
    check('trend_signals_text_check', sql`char_length(${t.text}) between 1 and 280`),
    check('trend_signals_url_check', sql`${t.url} is null or char_length(${t.url}) <= 2048`),
    check(
      'trend_signals_metrics_check',
      sql`coalesce(${t.views}, 0) >= 0 and coalesce(${t.likes}, 0) >= 0 and coalesce(${t.comments}, 0) >= 0`,
    ),
    check('trend_signals_lifetime_check', sql`${t.expiresAt} > ${t.observedAt}`),
    check(
      'trend_signals_link_check',
      sql`${t.source} not in ('agency_link', 'creator_link') or (${t.url} is not null and ${t.createdBy} is not null and ${t.creatorId} is not null and ${t.format} is not null)`,
    ),
    check(
      'trend_signals_reading_check',
      sql`(${t.source} = 'passive_capture') = (${t.readingId} is not null)`,
    ),
    unique('trend_signals_reading_unique').on(t.readingId),
    uniqueIndex('trend_signals_link_unique')
      .on(t.creatorId, t.url)
      .where(sql`${t.source} in ('agency_link', 'creator_link')`),
    index('trend_signals_creator_expiry_idx').on(t.creatorId, t.expiresAt),
    pgPolicy('team_read', {
      for: 'select',
      using: sql`${readsTeam} and (${t.creatorId} = ${currentCreator} or ${t.creatorId} is null)`,
    }),
    pgPolicy('member_link_insert', {
      for: 'insert',
      withCheck: sql`${anyMember} and ${t.source} = 'agency_link' and ${t.creatorId} = ${currentCreator} and ${t.createdBy} = ${currentUser}`,
    }),
    pgPolicy('creator_link_insert', {
      for: 'insert',
      withCheck: sql`${isCreatorAccount} and ${t.source} = 'creator_link' and ${t.creatorId} = ${currentCreator} and ${t.createdBy} = ${currentUser}`,
    }),
  ],
);

/**
 * A post the extension read while someone watched Instagram (ADR 0060 § 2, source 6): what the page showed, never the
 * media. One row per person, watch session and post code: a post seen again in the session, by any path, updates its
 * figures. The person who watched reads and writes theirs; the owner and an active manager read them all. The creator,
 * when she watches, marks a post for herself only.
 */
export const trendReadings = pgTable(
  'trend_readings',
  {
    id: id(),
    recordedBy: text('recorded_by')
      .notNull()
      .references(() => user.id),
    watchSessionId: uuid('watch_session_id').notNull(),
    postCode: text('post_code').notNull(),
    path: enumText('path').notNull(),
    account: text('account'),
    views: integer('views'),
    likes: integer('likes'),
    comments: integer('comments'),
    caption: text('caption'),
    /** The hashtags the page showed, a JSON list of strings (contracts `TrendReadingInputSchema`). */
    hashtags: jsonb('hashtags').notNull().default([]),
    sound: text('sound'),
    /** The sound's number in its address (`/reels/audio/<id>/`): the one key of a sound, whose name can repeat or change. */
    soundId: text('sound_id'),
    dwellMs: integer('dwell_ms').notNull(),
    markedFor: uuid('marked_for_creator_id').references(() => creators.id),
    firstSeenAt: timestampTz('first_seen_at').notNull(),
    seenAt: timestampTz('seen_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('trend_readings_session_post_unique').on(t.recordedBy, t.watchSessionId, t.postCode),
    index('trend_readings_account_idx').on(t.account, t.seenAt),
    index('trend_readings_marked_idx')
      .on(t.markedFor, t.seenAt)
      .where(sql`${t.markedFor} is not null`),
    index('trend_readings_sound_idx')
      .on(t.soundId, t.seenAt)
      .where(sql`${t.soundId} is not null`),
    check('trend_readings_sound_id_check', sql`${t.soundId} is null or ${t.soundId} ~ '^[0-9]{1,32}$'`),
    check('trend_readings_path_check', sql`${t.path} in ('post', 'reel')`),
    check('trend_readings_code_check', sql`${t.postCode} ~ '^[A-Za-z0-9_-]{5,64}$'`),
    check(
      'trend_readings_account_check',
      sql`${t.account} is null or ${t.account} ~ '^[A-Za-z0-9._]{1,30}$'`,
    ),
    check(
      'trend_readings_texts_check',
      sql`coalesce(char_length(${t.caption}), 0) <= 2200 and coalesce(char_length(${t.sound}), 1) between 1 and 200`,
    ),
    check(
      'trend_readings_hashtags_check',
      sql`jsonb_typeof(${t.hashtags}) = 'array' and jsonb_array_length(${t.hashtags}) <= 30`,
    ),
    check(
      'trend_readings_metrics_check',
      sql`coalesce(${t.views}, 0) >= 0 and coalesce(${t.likes}, 0) >= 0 and coalesce(${t.comments}, 0) >= 0`,
    ),
    check('trend_readings_dwell_check', sql`${t.dwellMs} between 0 and 2700000`),
    check('trend_readings_seen_check', sql`${t.seenAt} >= ${t.firstSeenAt}`),
    pgPolicy('recorder_all', {
      for: 'all',
      using: sql`${t.recordedBy} = ${currentUser}`,
      withCheck: sql`${t.recordedBy} = ${currentUser}`,
    }),
    pgPolicy('team_read', { for: 'select', using: readsTeam }),
    pgPolicy('creator_marks_her_own', {
      as: 'restrictive',
      for: 'all',
      using: sql`true`,
      withCheck: sql`${notCreatorAccount} or ${t.markedFor} is null or ${t.markedFor} = ${currentCreator}`,
    }),
  ],
);

/**
 * A content idea (ADR 0060 §§ 4 and 5): proposed by the morning job, validated, corrected or refused by the owner or an
 * active manager, then suggested in her agenda. A refused idea stays, so it is never proposed again. The creator never
 * reads one: she sees a suggestion of her agenda (ADR 0042 § 4).
 */
export const contentIdeas = pgTable(
  'content_ideas',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => trendSignals.id),
    title: text('title').notNull(),
    category: enumText('category').notNull(),
    toShoot: text('to_shoot').notNull(),
    reason: text('reason').notNull(),
    shootMinutes: integer('shoot_minutes').notNull(),
    state: enumText('state').notNull().default('proposed'),
    /** The day it was proposed, in her time zone. */
    proposedOn: date('proposed_on').notNull(),
    refusalReason: text('refusal_reason'),
    decidedBy: text('decided_by').references(() => user.id),
    decidedAt: timestampTz('decided_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('content_ideas', t.category, DROP_CATEGORIES),
    enumCheck('content_ideas', t.state, CONTENT_IDEA_STATES),
    check(
      'content_ideas_texts_check',
      sql`char_length(${t.title}) between 1 and 120 and char_length(${t.toShoot}) between 1 and 600 and char_length(${t.reason}) between 1 and 200`,
    ),
    check('content_ideas_shoot_minutes_check', sql`${t.shootMinutes} between 1 and 600`),
    check(
      'content_ideas_refusal_check',
      sql`${t.refusalReason} is null or (${t.state} = 'refused' and char_length(${t.refusalReason}) between 1 and 280)`,
    ),
    check(
      'content_ideas_decided_check',
      sql`(${t.state} = 'proposed') = (${t.decidedAt} is null) and (${t.decidedBy} is null or ${t.decidedAt} is not null)`,
    ),
    index('content_ideas_creator_day_idx').on(t.creatorId, t.proposedOn),
    pgPolicy('team_all', {
      for: 'all',
      using: sql`${t.creatorId} = ${currentCreator} and ${readsTeam}`,
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${readsTeam}`,
    }),
  ],
);

/**
 * The link between one person's extension and the server (VEI-01): a token drawn by the server, shown once, kept as its
 * SHA-256, revocable, for the readings only. One live link per account; a new one revokes the one before. Out of RLS
 * and out of `nirvana_app`'s reach (migration), like `calendar_links`: read through `withAdmin` only.
 */
export const extensionLinks = pgTable(
  'extension_links',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    /** SHA-256 of the token, base64url. */
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: createdAt(),
    lastUsedAt: timestampTz('last_used_at'),
    revokedAt: timestampTz('revoked_at'),
  },
  (t) => [
    check('extension_links_revoked_check', sql`${t.revokedAt} is null or ${t.revokedAt} >= ${t.createdAt}`),
    uniqueIndex('extension_links_live_unique')
      .on(t.userId)
      .where(sql`${t.revokedAt} is null`),
  ],
);
