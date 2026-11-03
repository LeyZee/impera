import { DestinationSchema, type Verdict } from '@impera/contracts';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { closedToCreator, createdAt, enumCheck, enumText, id, tenantPolicy, timestampTz } from './columns';
import { creators } from './tenancy';

const VERDICT_KINDS = ['validated', 'corrected', 'rejected'] as const satisfies readonly Verdict['kind'][];

/**
 * The playground's ratings (module `agent`, calibration): append-only, read for the validation rate, the voice's
 * examples and the replayable tests. Only `moment` (the conversation as it was) may be purged after 90 days, by
 * setting it to null with `moment_purged_at`; the verdict and the version are kept for good (migration 0005).
 */
export const calibrationRatings = pgTable(
  'calibration_ratings',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    sessionId: text('session_id').notNull(),
    ratedAt: timestampTz('rated_at').notNull(),
    voicePrompt: text('voice_prompt').notNull(),
    voiceModel: text('voice_model').notNull(),
    verdictKind: enumText('verdict_kind').notNull(),
    /** `Verdict` (packages/contracts): the corrected text or the reason of a rejection. */
    verdict: jsonb('verdict').notNull(),
    destination: enumText('destination'),
    fanMessage: text('fan_message').notNull(),
    bubbles: jsonb('bubbles').$type<string[]>().notNull(),
    /** `RatedMoment` (module `agent`), opaque here, never queried; null once purged. */
    moment: jsonb('moment'),
    momentPurgedAt: timestampTz('moment_purged_at'),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('calibration_ratings', t.verdictKind, VERDICT_KINDS),
    enumCheck('calibration_ratings', t.destination, DestinationSchema.options),
    // A purged row keeps its verdict: `moment` and `moment_purged_at` go together.
    check(
      'calibration_ratings_moment_purge_check',
      sql`(${t.moment} is null) = (${t.momentPurgedAt} is not null)`,
    ),
    index('calibration_ratings_creator_at_idx').on(t.creatorId, t.ratedAt.desc()),
    index('calibration_ratings_version_idx').on(t.creatorId, t.voicePrompt, t.voiceModel, t.ratedAt.desc()),
    tenantPolicy(t.creatorId),
    closedToCreator(),
  ],
);
