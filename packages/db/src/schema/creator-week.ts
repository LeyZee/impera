import { CREATOR_WEEK_STATES } from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  date,
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
 * Her week as the code proposes it (ADR 0140 § 2 to § 5, § 13): one per creator and Monday, written by the job
 * (`withAdmin`) as a draft, read by her team, corrected and validated by the owner only. She never reads it: what
 * reaches her are the suggestions the validation writes in her agenda. Never deleted.
 */

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const notCreatorAccount: SQL = sql`current_setting('app.account_role', true) is distinct from 'creator'`;
const ofHerTeam = (creatorId: PgColumn): SQL =>
  sql`${notCreatorAccount} and ${currentScope} in ('owner', 'agency') and ${creatorId} = ${currentCreator}`;
const ofHerOwner = (creatorId: PgColumn): SQL =>
  sql`${notCreatorAccount} and ${currentScope} = 'owner' and ${creatorId} = ${currentCreator}`;

export const creatorWeeks = pgTable(
  'creator_weeks',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    /** Her Monday. */
    week: date('week', { mode: 'string' }).notNull(),
    state: enumText('state').notNull().default('draft'),
    /** `WeekPlanSchema`, parsed on write and on read (docs/architecture/jsonb.md). */
    plan: jsonb('plan').notNull(),
    computedAt: timestampTz('computed_at').notNull(),
    validatedBy: text('validated_by').references(() => user.id),
    validatedAt: timestampTz('validated_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('creator_weeks', t.state, CREATOR_WEEK_STATES),
    check('creator_weeks_week_check', sql`extract(isodow from ${t.week}) = 1`),
    check('creator_weeks_plan_check', sql`jsonb_typeof(${t.plan}) = 'object'`),
    check(
      'creator_weeks_validation_check',
      sql`(${t.state} = 'validated') = (${t.validatedAt} is not null)
        and (${t.validatedAt} is null) = (${t.validatedBy} is null)`,
    ),
    unique('creator_weeks_creator_week_unique').on(t.creatorId, t.week),
    pgPolicy('team_read', { for: 'select', using: ofHerTeam(t.creatorId) }),
    // The owner validates, by his own name; a validated week stays validated.
    pgPolicy('owner_validate', {
      for: 'update',
      using: sql`${ofHerOwner(t.creatorId)} and ${t.state} = 'draft'`,
      withCheck: sql`${ofHerOwner(t.creatorId)} and ${t.state} = 'validated' and ${t.validatedBy} = ${currentUser}`,
    }),
  ],
);
