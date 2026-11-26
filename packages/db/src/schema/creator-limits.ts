import { ABSENCE_DAYS_MAX, LIMIT_TEXT_MAX } from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { check, date, index, pgPolicy, pgTable, text, uuid, type PgColumn } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, timestampTz } from './columns';
import { creators } from './tenancy';

/**
 * What she tells the agency herself (Charles, 21/11, contracts `creator-limits.ts`): when she will be away, and what she
 * no longer does. Written by her alone, in her own account (`withCreatorAccount`); read by whoever the server opened her
 * creator to (`withTenant`, after its own check: the owner, her managers, a chatter on her list or on shift), as her
 * sheet is. She takes one back, never deletes it: the row stays, marked.
 */

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const isCreatorAccount: SQL = sql`current_setting('app.account_role', true) = 'creator'`;
const hers = (creatorId: PgColumn): SQL => sql`${isCreatorAccount} and ${creatorId} = ${currentCreator}`;

export const creatorAbsences = pgTable(
  'creator_absences',
  {
    /** Chosen by her phone: a replay writes nothing twice. */
    id: uuid('id').primaryKey(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    note: text('note'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    cancelledAt: timestampTz('cancelled_at'),
    cancelledBy: text('cancelled_by').references(() => user.id),
  },
  (t) => [
    index('creator_absences_creator_ends_idx').on(t.creatorId, t.endsOn),
    check('creator_absences_days_check', sql`${t.startsOn} <= ${t.endsOn}`),
    check(
      'creator_absences_span_check',
      sql`${t.endsOn} - ${t.startsOn} < ${sql.raw(String(ABSENCE_DAYS_MAX))}`,
    ),
    check('creator_absences_note_check', sql`char_length(${t.note}) <= ${sql.raw(String(LIMIT_TEXT_MAX))}`),
    check('creator_absences_cancel_check', sql`(${t.cancelledAt} is null) = (${t.cancelledBy} is null)`),
    pgPolicy('tenant_read', { for: 'select', using: sql`${t.creatorId} = ${currentCreator}` }),
    pgPolicy('creator_insert', {
      for: 'insert',
      withCheck: sql`${hers(t.creatorId)} and ${t.createdBy} = ${currentUser} and ${t.cancelledAt} is null`,
    }),
    pgPolicy('creator_update', {
      for: 'update',
      using: hers(t.creatorId),
      withCheck: sql`${hers(t.creatorId)} and ${t.cancelledBy} = ${currentUser}`,
    }),
  ],
);

export const creatorStops = pgTable(
  'creator_stops',
  {
    id: uuid('id').primaryKey(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    what: text('what').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    withdrawnAt: timestampTz('withdrawn_at'),
    withdrawnBy: text('withdrawn_by').references(() => user.id),
  },
  (t) => [
    index('creator_stops_creator_idx').on(t.creatorId),
    check(
      'creator_stops_what_check',
      sql`char_length(${t.what}) between 1 and ${sql.raw(String(LIMIT_TEXT_MAX))}`,
    ),
    check('creator_stops_withdraw_check', sql`(${t.withdrawnAt} is null) = (${t.withdrawnBy} is null)`),
    pgPolicy('tenant_read', { for: 'select', using: sql`${t.creatorId} = ${currentCreator}` }),
    pgPolicy('creator_insert', {
      for: 'insert',
      withCheck: sql`${hers(t.creatorId)} and ${t.createdBy} = ${currentUser} and ${t.withdrawnAt} is null`,
    }),
    pgPolicy('creator_update', {
      for: 'update',
      using: hers(t.creatorId),
      withCheck: sql`${hers(t.creatorId)} and ${t.withdrawnBy} = ${currentUser}`,
    }),
  ],
);
