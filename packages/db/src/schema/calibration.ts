import { CalibrationSourceSchema, DestinationSchema, type Verdict } from '@impera/contracts';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { closedToCreator, createdAt, enumCheck, enumText, id, tenantPolicy, timestampTz } from './columns';
import { drafts } from './conversations';
import { creators } from './tenancy';

const VERDICT_KINDS = ['validated', 'corrected', 'rejected'] as const satisfies readonly Verdict['kind'][];

/**
 * The ratings (module `agent`, calibration): append-only, read for the validation rate, the voice's examples and the
 * replayable tests. A `playground` rating names its session and keeps the moment: only `moment` (the conversation as it
 * was) may be purged after 90 days, by setting it to null with `moment_purged_at`; the verdict and the version are kept
 * for good (migration 0005). A `live` rating is a real draft judged through the copilot panel (ADR 0086 § 5): it names
 * the draft, one rating per draft, and keeps neither the fan's message nor a moment, his words staying in the
 * conversation under their own retention (migration 0149).
 */
export const calibrationRatings = pgTable(
  'calibration_ratings',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    /** `playground` only. */
    sessionId: text('session_id'),
    source: enumText('source').notNull().default('playground'),
    /** `live` only: the draft judged; one rating per draft. */
    draftId: uuid('draft_id').references(() => drafts.id),
    ratedAt: timestampTz('rated_at').notNull(),
    voicePrompt: text('voice_prompt').notNull(),
    voiceModel: text('voice_model').notNull(),
    verdictKind: enumText('verdict_kind').notNull(),
    /** `Verdict` (packages/contracts): the corrected text or the reason of a rejection. */
    verdict: jsonb('verdict').notNull(),
    destination: enumText('destination'),
    /** `playground` only: a real fan's words are never copied here. */
    fanMessage: text('fan_message'),
    bubbles: jsonb('bubbles').$type<string[]>().notNull(),
    /** `RatedMoment` (module `agent`), opaque here, never queried; null once purged. */
    moment: jsonb('moment'),
    momentPurgedAt: timestampTz('moment_purged_at'),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('calibration_ratings', t.verdictKind, VERDICT_KINDS),
    enumCheck('calibration_ratings', t.destination, DestinationSchema.options),
    enumCheck('calibration_ratings', t.source, CalibrationSourceSchema.options),
    // A playground rating names its session and its fan's message, and a purged one keeps its verdict (`moment` and
    // `moment_purged_at` go together); a live one names its draft and keeps no moment nor fan's words.
    check(
      'calibration_ratings_source_shape_check',
      sql`(${t.source} = 'playground' and ${t.sessionId} is not null and ${t.draftId} is null and ${t.fanMessage} is not null and (${t.moment} is null) = (${t.momentPurgedAt} is not null))
        or (${t.source} = 'live' and ${t.draftId} is not null and ${t.sessionId} is null and ${t.fanMessage} is null and ${t.moment} is null and ${t.momentPurgedAt} is null)`,
    ),
    uniqueIndex('calibration_ratings_draft_unique')
      .on(t.draftId)
      .where(sql`${t.draftId} is not null`),
    index('calibration_ratings_creator_at_idx').on(t.creatorId, t.ratedAt.desc()),
    index('calibration_ratings_version_idx').on(t.creatorId, t.voicePrompt, t.voiceModel, t.ratedAt.desc()),
    tenantPolicy(t.creatorId),
    closedToCreator(),
  ],
);
