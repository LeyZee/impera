import { DesireMarkVerdictSchema } from '@impera/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { calibrationRatings } from './calibration';
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
import { personaVersions } from './persona';
import { creators } from './tenancy';

/*
 * The playground kept in the database (ADR 0103, migration 0185): its conversations, the cases made of its misses and
 * their replays, and the owner's marks on the desire score. A creator's own account never reads any of it: these are
 * the agency's training rows (`closedToCreator`). The invented persona belongs to no creator and is not kept (§ 7).
 */

/** One conversation played against a version of hers, kept as the session left it (§ 1). */
export const playgroundConversations = pgTable(
  'playground_conversations',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    personaVersionId: uuid('persona_version_id')
      .notNull()
      .references(() => personaVersions.id),
    /** The owner who played it: each trainer resumes their own. */
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    /** The session as it stood (module `playground`), opaque here, never queried. */
    state: jsonb('state').notNull(),
    /** His messages in it: the list shows the conversations worth resuming. */
    fanMessages: integer('fan_messages').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('playground_conversations_state_check', sql`jsonb_typeof(${t.state}) = 'object'`),
    check('playground_conversations_fan_messages_check', sql`${t.fanMessages} >= 0`),
    index('playground_conversations_user_idx').on(t.creatorId, t.userId, t.updatedAt.desc()),
    tenantPolicy(t.creatorId),
    closedToCreator(),
  ],
);

/** A miss made into a case (§ 3): the moment as it was, and what should have happened, in the owner's words. */
export const playgroundCases = pgTable(
  'playground_cases',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    /** The version that missed it. */
    personaVersionId: uuid('persona_version_id')
      .notNull()
      .references(() => personaVersions.id),
    /** The rating it came from, when it came from one. */
    ratingId: uuid('rating_id').references(() => calibrationRatings.id),
    /** `RatedMoment` (module `agent`): the conversation up to his message, the situation. */
    moment: jsonb('moment').notNull(),
    fanMessage: text('fan_message').notNull(),
    /** Her answer that missed, as it was written. */
    missedBubbles: jsonb('missed_bubbles').$type<string[]>().notNull(),
    expectation: text('expectation').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    /** Set aside by the owner: no longer replayed, kept with its runs. */
    retiredAt: timestampTz('retired_at'),
  },
  (t) => [
    check('playground_cases_moment_check', sql`jsonb_typeof(${t.moment}) = 'object'`),
    check('playground_cases_expectation_check', sql`char_length(${t.expectation}) between 1 and 500`),
    index('playground_cases_creator_idx').on(t.creatorId, t.createdAt.desc()),
    tenantPolicy(t.creatorId),
    closedToCreator(),
  ],
);

/** One replay of a case on a version (§ 4): what she wrote, the judge's verdict, and the owner's when he overrode it. */
export const playgroundCaseRuns = pgTable(
  'playground_case_runs',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    caseId: uuid('case_id')
      .notNull()
      .references(() => playgroundCases.id),
    personaVersionId: uuid('persona_version_id')
      .notNull()
      .references(() => personaVersions.id),
    /** The cases replayed together share it. */
    batchId: uuid('batch_id').notNull(),
    bubbles: jsonb('bubbles').$type<string[]>().notNull(),
    /** Null when the judge could not answer. */
    judgePassed: boolean('judge_passed'),
    judgeNote: text('judge_note'),
    /** The owner's last word, when he overrode the judge. */
    ownerPassed: boolean('owner_passed'),
    costUsd: doublePrecision('cost_usd'),
    createdAt: createdAt(),
  },
  (t) => [
    index('playground_case_runs_case_idx').on(t.creatorId, t.caseId, t.createdAt.desc()),
    index('playground_case_runs_batch_idx').on(t.creatorId, t.batchId),
    tenantPolicy(t.creatorId),
    closedToCreator(),
  ],
);

/**
 * The owner's mark on his desire score under one message of his (§ 6). `reading` keeps the counting as it was (score
 * before and after, every signal counted, the weights' version): a new counting is replayed on it by code, no model.
 */
export const desireMarks = pgTable(
  'desire_marks',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    /** Null once the owner deleted the conversation: the mark keeps its message and its reading. */
    conversationId: uuid('conversation_id').references(() => playgroundConversations.id, {
      onDelete: 'set null',
    }),
    /** His n-th message in that conversation, from 1. */
    fanMessageNumber: integer('fan_message_number').notNull(),
    fanMessage: text('fan_message').notNull(),
    verdict: enumText('verdict').notNull(),
    note: text('note'),
    reading: jsonb('reading').notNull(),
    weightsVersion: text('weights_version').notNull(),
    markedBy: text('marked_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('desire_marks', t.verdict, DesireMarkVerdictSchema.options),
    check('desire_marks_number_check', sql`${t.fanMessageNumber} >= 1`),
    check('desire_marks_note_check', sql`${t.note} is null or char_length(${t.note}) between 1 and 500`),
    check('desire_marks_reading_check', sql`jsonb_typeof(${t.reading}) = 'object'`),
    index('desire_marks_creator_idx').on(t.creatorId, t.createdAt.desc()),
    tenantPolicy(t.creatorId),
    closedToCreator(),
  ],
);
