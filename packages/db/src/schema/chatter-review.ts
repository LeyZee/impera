import { FAULT_LABEL_MAX, FAULT_LEVELS, REMARK_CONTEST_MAX, REMARK_RULINGS } from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { check, pgPolicy, pgTable, primaryKey, text, uuid, type PgColumn } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { enumCheck, timestampTz } from './columns';
import { teamMembers } from './team';
import { creators } from './tenancy';

/**
 * The chatter's review, the `team` side (ADR 0170 §§ 14, 28 and 29). The faults' levels and labels are saved by the
 * owner, out of the repository: no migration nor seed carries one. The remarks themselves belong to the `agent` module;
 * `remark_id` names one without a foreign key until its table exists.
 *
 * Explanations, contests and rulings are append-only: what a chatter was told, what he contested and what was decided
 * stay as they were. Forced RLS, revoked privileges and explicit grants are in the migration.
 */

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const isOwner: SQL = sql`${currentScope} = 'owner'`;

/** The member of the row is the signed-in account. */
const isMine = (memberId: PgColumn | SQL): SQL =>
  sql`exists (select 1 from team_members m where m.id = ${memberId} and m.user_id = ${currentUser})`;

/** The owner, or a manager of this creator. */
const managesCreator = (creatorId: PgColumn): SQL =>
  sql`(${isOwner} or (${currentScope} = 'agency' and exists (select 1 from "user" u where u.id = ${currentUser} and ${creatorId} = any(u.creator_ids))))`;

/** A fault's level and label, one row per neutral code (ADR 0170 § 28): every member reads, the owner alone writes. */
export const chatterFaultLevels = pgTable(
  'chatter_fault_levels',
  {
    faultCode: text('fault_code').primaryKey(),
    level: text('level').notNull(),
    label: text('label').notNull(),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: timestampTz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    enumCheck('chatter_fault_levels', t.level, FAULT_LEVELS),
    check('chatter_fault_levels_code_check', sql`${t.faultCode} ~ '^fault\\.[a-z0-9_]{1,60}$'`),
    check(
      'chatter_fault_levels_label_check',
      sql`char_length(${t.label}) between 1 and ${sql.raw(String(FAULT_LABEL_MAX))}`,
    ),
    pgPolicy('team_read', { for: 'select', using: sql`${currentScope} is not null` }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${isOwner} and ${t.updatedBy} = ${currentUser}`,
    }),
    pgPolicy('owner_update', {
      for: 'update',
      using: isOwner,
      withCheck: sql`${isOwner} and ${t.updatedBy} = ${currentUser} and ${t.updatedAt} = now()`,
    }),
  ],
);

/**
 * When a fault was first explained to a chatter, for a creator (ADR 0170 § 29): written when he opens the review that
 * shows it, once. Only later occurrences count.
 */
export const chatterFaultExplanations = pgTable(
  'chatter_fault_explanations',
  {
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    faultCode: text('fault_code')
      .notNull()
      .references(() => chatterFaultLevels.faultCode),
    remarkId: uuid('remark_id').notNull(),
    explainedAt: timestampTz('explained_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.creatorId, t.memberId, t.faultCode] }),
    pgPolicy('member_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and (${managesCreator(t.creatorId)} or ${isMine(t.memberId)})`,
    }),
    pgPolicy('member_insert', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${isMine(t.memberId)} and ${t.explainedAt} = now()`,
    }),
  ],
);

/** A chatter contests a remark in one line (ADR 0170 § 14): once, never changed. */
export const chatterRemarkContests = pgTable(
  'chatter_remark_contests',
  {
    remarkId: uuid('remark_id').primaryKey(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    reason: text('reason').notNull(),
    saidAt: timestampTz('said_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'chatter_remark_contests_reason_check',
      sql`char_length(${t.reason}) between 1 and ${sql.raw(String(REMARK_CONTEST_MAX))}`,
    ),
    pgPolicy('member_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and (${managesCreator(t.creatorId)} or ${isMine(t.memberId)})`,
    }),
    pgPolicy('member_insert', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${isMine(t.memberId)} and ${t.saidAt} = now()`,
    }),
  ],
);

/**
 * The owner or a manager settles a contest (ADR 0170 § 14), never his own: once, never changed. A dropped remark never
 * counts.
 */
export const chatterRemarkRulings = pgTable(
  'chatter_remark_rulings',
  {
    remarkId: uuid('remark_id')
      .primaryKey()
      .references(() => chatterRemarkContests.remarkId),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    ruling: text('ruling').notNull(),
    saidBy: text('said_by')
      .notNull()
      .references(() => user.id),
    saidAt: timestampTz('said_at').notNull().defaultNow(),
  },
  (t) => [
    enumCheck('chatter_remark_rulings', t.ruling, REMARK_RULINGS),
    pgPolicy('member_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and exists (select 1 from chatter_remark_contests c where c.remark_id = ${t.remarkId})`,
    }),
    pgPolicy('manager_insert', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${managesCreator(t.creatorId)} and ${t.saidBy} = ${currentUser} and ${t.saidAt} = now() and exists (select 1 from chatter_remark_contests c where c.remark_id = ${t.remarkId} and c.creator_id = ${t.creatorId} and not ${isMine(sql`c.member_id`)})`,
    }),
  ],
);
