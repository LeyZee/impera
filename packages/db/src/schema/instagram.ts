import { INSTAGRAM_MEDIA_KINDS, SNAPSHOT_AGES } from '@impera/contracts';
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { closedToCreator, createdAt, enumCheck, enumText, id, timestampTz } from './columns';
import { creators } from './tenancy';

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const notCreatorAccount: SQL = sql`current_setting('app.account_role', true) is distinct from 'creator'`;
/** The reading of her Instagram numbers, in the creator it writes (`withTenantJob(…, 'media_insights', …)`). */
const mediaInsightsJob = (creatorId: AnyColumn): SQL =>
  sql`${creatorId} = ${currentCreator} and nullif(current_setting('app.job', true), '') = 'media_insights'`;

/**
 * A reading kept of one of her Instagram media (ADR 0120 § 2, amendment of 20/11/2026): one row per media and per
 * age, numbers only. Never the caption, never a comment's text, never a name. A row is written once and never
 * changed: either the numbers read inside the window of its age, or `missed`, without a number, when the window
 * passed without a reading. A number Meta does not give for this kind of media is null, never 0.
 *
 * Written by the reading job alone, under the app role, one creator at a time (`withTenantJob`): it inserts and
 * reads, it never updates nor deletes. Read by the owner, or an active manager when she is on his list, as the
 * platform's daily statistics; never by a chatter, and closed to a creator's own account.
 */
export const mediaInsightSnapshots = pgTable(
  'media_insight_snapshots',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'cascade' }),
    /** How Instagram names the media: opaque to us. */
    mediaRef: text('media_ref').notNull(),
    mediaKind: enumText('media_kind').notNull(),
    publishedAt: timestampTz('published_at').notNull(),
    age: enumText('age').notNull(),
    /** When the step was read, or when it was found missed. */
    readAt: timestampTz('read_at').notNull(),
    missed: boolean('missed').notNull(),
    views: integer('views'),
    reach: integer('reach'),
    likes: integer('likes'),
    commentCount: integer('comment_count'),
    shares: integer('shares'),
    saves: integer('saves'),
    reposts: integer('reposts'),
    /** The part of the viewers of a Reel who skipped it at once, 0 to 1. */
    skipRate: numeric('skip_rate', { precision: 5, scale: 4, mode: 'number' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('media_insight_snapshots_step_unique').on(t.creatorId, t.mediaRef, t.age),
    index('media_insight_snapshots_creator_published_idx').on(t.creatorId, t.publishedAt),
    enumCheck('media_insight_snapshots', t.mediaKind, INSTAGRAM_MEDIA_KINDS),
    enumCheck('media_insight_snapshots', t.age, SNAPSHOT_AGES),
    check('media_insight_snapshots_media_ref_check', sql`char_length(${t.mediaRef}) between 1 and 128`),
    // A missed step carries no number at all; a step read carries the six numbers Meta gives of every media.
    check(
      'media_insight_snapshots_missed_check',
      sql`case when ${t.missed} then num_nulls(${t.views}, ${t.reach}, ${t.likes}, ${t.commentCount}, ${t.shares}, ${t.saves}, ${t.reposts}, ${t.skipRate}) = 8 else num_nulls(${t.views}, ${t.reach}, ${t.likes}, ${t.commentCount}, ${t.shares}, ${t.saves}) = 0 end`,
    ),
    check(
      'media_insight_snapshots_counts_check',
      sql`coalesce(${t.views}, 0) >= 0 and coalesce(${t.reach}, 0) >= 0 and coalesce(${t.likes}, 0) >= 0 and coalesce(${t.commentCount}, 0) >= 0 and coalesce(${t.shares}, 0) >= 0 and coalesce(${t.saves}, 0) >= 0 and coalesce(${t.reposts}, 0) >= 0`,
    ),
    check(
      'media_insight_snapshots_skip_rate_check',
      sql`${t.skipRate} is null or (${t.mediaKind} = 'reel' and ${t.skipRate} between 0 and 1)`,
    ),
    pgPolicy('insights_read', {
      for: 'select',
      using: sql`${notCreatorAccount} and ${t.creatorId} = ${currentCreator} and (${currentScope} = 'owner' or (${currentScope} = 'agency' and exists (select 1 from "user" u where u.id = ${currentUser} and ${t.creatorId} = any(u.creator_ids))))`,
    }),
    // The job reads the steps already kept, then inserts the new ones. No update: a step kept is never replaced.
    pgPolicy('job_read', { for: 'select', using: mediaInsightsJob(t.creatorId) }),
    pgPolicy('job_insert', { for: 'insert', withCheck: mediaInsightsJob(t.creatorId) }),
    closedToCreator(),
  ],
);
