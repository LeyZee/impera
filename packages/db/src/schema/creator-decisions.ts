import {
  CREATOR_DECISION_KINDS,
  CREATOR_TASK_CATEGORIES,
  DECISION_ANSWERS_MAX,
  DECISION_ANSWERS_MIN,
  DECISION_LAYOUTS,
  DECISION_OTHER_IDEAS_MAX,
  DECISION_STATES,
} from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
  type PgColumn,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, enumCheck, enumText, id, timestampTz, updatedAt } from './columns';
import { creators } from './tenancy';

/*
 * « À décider », hers (ADR 0164): a question put to her about a content of hers, with two or three answers. A row is
 * written by the code that asks, in the creator it asks for (`withTenantJob(…, 'creator_decisions', …)`), once per
 * subject. She reads her own and answers it or puts it aside; the owner reads and answers in her place; a manager
 * and a chatter read none. An answer is given once: a row that is no longer open matches no policy that changes it.
 * The app role may change only the columns of an answer (grant by column, in the migration).
 */

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const isCreatorAccount: SQL = sql`current_setting('app.account_role', true) = 'creator'`;
const notCreatorAccount: SQL = sql`current_setting('app.account_role', true) is distinct from 'creator'`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const hers = (creatorId: PgColumn): SQL => sql`${isCreatorAccount} and ${creatorId} = ${currentCreator}`;
const ofHerOwner = (creatorId: PgColumn): SQL =>
  sql`${notCreatorAccount} and ${currentScope} = 'owner' and ${creatorId} = ${currentCreator}`;
/** The code that asks, in the creator it asks for. An account's session never carries a job's name. */
const asking = (creatorId: PgColumn): SQL =>
  sql`${creatorId} = ${currentCreator} and nullif(current_setting('app.job', true), '') = 'creator_decisions'`;

/** An account leaves a row open or answered, never withdrawn, and signs an answer with itself alone. */
const answeredByHand = (state: PgColumn, answeredBy: PgColumn): SQL =>
  sql`${state} in ('open', 'answered') and (${answeredBy} is null or ${answeredBy} = ${currentUser})`;

export const creatorDecisions = pgTable(
  'creator_decisions',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    kind: enumText('kind').notNull(),
    /** What it is about, named by who asks: asked twice, written once. */
    subject: text('subject').notNull(),
    category: enumText('category').notNull(),
    question: text('question').notNull(),
    context: text('context').notNull(),
    layout: enumText('layout').notNull(),
    /** `DecisionAnswerSchema[]`, parsed on write and on read. */
    answers: jsonb('answers').notNull(),
    otherIdeasLeft: integer('other_ideas_left').notNull().default(0),
    state: enumText('state').notNull().default('open'),
    answerKey: text('answer_key'),
    answeredAt: timestampTz('answered_at'),
    answeredBy: text('answered_by').references(() => user.id),
    /** « Plus tard »: aside until then. */
    laterUntil: timestampTz('later_until'),
    /** After it the question no longer makes sense: nobody reads it, nobody answers it. */
    expiresAt: timestampTz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('creator_decisions_subject_unique').on(t.creatorId, t.kind, t.subject),
    index('creator_decisions_open_idx').on(t.creatorId, t.state, t.expiresAt),
    enumCheck('creator_decisions', t.kind, CREATOR_DECISION_KINDS),
    enumCheck('creator_decisions', t.category, CREATOR_TASK_CATEGORIES),
    enumCheck('creator_decisions', t.layout, DECISION_LAYOUTS),
    enumCheck('creator_decisions', t.state, DECISION_STATES),
    check(
      'creator_decisions_text_check',
      sql`char_length(${t.question}) between 1 and 120 and char_length(${t.context}) between 1 and 200 and char_length(${t.subject}) between 1 and 64`,
    ),
    check(
      'creator_decisions_answers_check',
      sql`jsonb_typeof(${t.answers}) = 'array' and jsonb_array_length(${t.answers}) between ${sql.raw(String(DECISION_ANSWERS_MIN))} and ${sql.raw(String(DECISION_ANSWERS_MAX))}`,
    ),
    check(
      'creator_decisions_other_ideas_check',
      sql`${t.otherIdeasLeft} between 0 and ${sql.raw(String(DECISION_OTHER_IDEAS_MAX))}`,
    ),
    // An answer is whole or absent: which, when, by whom.
    check(
      'creator_decisions_answered_check',
      sql`(${t.state} = 'answered') = (${t.answerKey} is not null and ${t.answeredAt} is not null and ${t.answeredBy} is not null)`,
    ),
    pgPolicy('hers_read', { for: 'select', using: hers(t.creatorId) }),
    pgPolicy('hers_answer', {
      for: 'update',
      using: sql`${hers(t.creatorId)} and ${t.state} = 'open'`,
      withCheck: sql`${hers(t.creatorId)} and ${answeredByHand(t.state, t.answeredBy)}`,
    }),
    pgPolicy('owner_read', { for: 'select', using: ofHerOwner(t.creatorId) }),
    pgPolicy('owner_answer', {
      for: 'update',
      using: sql`${ofHerOwner(t.creatorId)} and ${t.state} = 'open'`,
      withCheck: sql`${ofHerOwner(t.creatorId)} and ${answeredByHand(t.state, t.answeredBy)}`,
    }),
    pgPolicy('asking_read', { for: 'select', using: asking(t.creatorId) }),
    pgPolicy('asking_insert', { for: 'insert', withCheck: asking(t.creatorId) }),
    // Who asked may withdraw a question still open, and nothing else of it.
    pgPolicy('asking_withdraw', {
      for: 'update',
      using: sql`${asking(t.creatorId)} and ${t.state} = 'open'`,
      withCheck: sql`${asking(t.creatorId)} and ${t.state} = 'withdrawn'`,
    }),
  ],
);
