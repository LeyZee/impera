import { CurrencySchema, SHIFT_REPORT_MAX_MINOR, SHIFT_REPORT_STATUSES } from '@nirvana/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  smallint,
  type PgColumn,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, enumCheck, id, timestampTz, updatedAt } from './columns';
import { teamMembers } from './team';
import { creators, platformAccounts } from './tenancy';

/**
 * The planning (ADR 0023 § Données et RLS, EQ-02). Shifts and templates carry `creator_id` **and** `member_id`, and
 * their policies ask for both: the creator of `withTenant` (`app.creator_id`), and the member himself or the scope
 * `owner` | `agency` of `withMember` (`withTenantMember` sets the three). Only the owner and an active manager write.
 * The settings have no creator: every member reads them, the owner alone writes them.
 *
 * Two exclusion constraints, added by hand to the migration (Drizzle does not write them), keep a member off two
 * shifts at once and an account off two members at once, cancelled shifts aside. A composite key keeps each row's
 * account on its creator: no row can open the wrong creator in the access window of ADR 0025.
 */

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const plans: SQL = sql`${currentScope} in ('owner', 'agency')`;
const isOwner: SQL = sql`${currentScope} = 'owner'`;

/** The member of the row is the signed-in account. */
const isMine = (memberId: PgColumn | SQL): SQL =>
  sql`exists (select 1 from team_members m where m.id = ${memberId} and m.user_id = ${currentUser})`;

/**
 * A swap names this shift (ADR 0031), and the signed-in member made or received it. Raw table name: `shift_swap_requests`
 * is declared below, and its own policies never read `shifts` (Postgres refuses policies that loop).
 */
const namedBySwapOfMine: SQL = sql`exists (select 1 from shift_swap_requests s where (s.shift_id = "shifts"."id" or s.target_shift_id = "shifts"."id") and s.status in ('proposed', 'accepted') and (${isMine(sql`s.requester_id`)} or ${isMine(sql`s.target_member_id`)}))`;

/**
 * The swap accepted in this very transaction (`resolved_at = now()`) by the signed-in member, the colleague asked, names
 * this shift: the proof that lets a chatter move it (ADR 0031). Bound to the transaction, so that a shift a manager
 * gave to someone else afterwards is never taken back by the old swap.
 */
const acceptedNowByMe = (shape: SQL): SQL =>
  sql`exists (select 1 from shift_swap_requests s where s.status = 'accepted' and s.resolved_at = now() and ${isMine(sql`s.target_member_id`)} and (${shape}))`;

/** One row at most (`id = 1`): no row means the defaults of the `scheduling` module. */
export const schedulingSettings = pgTable(
  'scheduling_settings',
  {
    id: smallint('id').primaryKey(),
    timeZone: text('time_zone').notNull(),
    slotStartMinute: integer('slot_start_minute').notNull(),
    slotLengthMinutes: integer('slot_length_minutes').notNull(),
    accessMarginMinutes: integer('access_margin_minutes').notNull(),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('scheduling_settings_single_check', sql`${t.id} = 1`),
    check(
      'scheduling_settings_slots_check',
      sql`${t.slotLengthMinutes} in (60, 120, 180, 240, 360, 480, 720) and ${t.slotStartMinute} >= 0 and ${t.slotStartMinute} < ${t.slotLengthMinutes}`,
    ),
    check('scheduling_settings_margin_check', sql`${t.accessMarginMinutes} between 0 and 120`),
    pgPolicy('team_read', { for: 'select', using: sql`${currentScope} is not null` }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${isOwner} and ${t.updatedBy} = ${currentUser}`,
    }),
    pgPolicy('owner_update', {
      for: 'update',
      using: isOwner,
      withCheck: sql`${isOwner} and ${t.updatedBy} = ${currentUser}`,
    }),
  ],
);

/**
 * A weekly shift, in wall-clock minutes of the grid's zone (an end at or before the start is the next day), 23 hours
 * at most. Never edited: only `valid_until` changes, when it ends (the migration grants that column alone, and a
 * trigger refuses any other change, whoever asks).
 */
export const shiftTemplates = pgTable(
  'shift_templates',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platformAccountId: uuid('platform_account_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    /** ISO weekday: 1 Monday … 7 Sunday. */
    weekday: smallint('weekday').notNull(),
    startMinute: integer('start_minute').notNull(),
    endMinute: integer('end_minute').notNull(),
    validFrom: date('valid_from').notNull(),
    /** Its last day; the day before `valid_from` for a template ended before it ran. */
    validUntil: date('valid_until'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('shift_templates_weekday_check', sql`${t.weekday} between 1 and 7`),
    check(
      'shift_templates_minutes_check',
      sql`${t.startMinute} between 0 and 1439 and ${t.endMinute} between 0 and 1439 and ${t.startMinute} <> ${t.endMinute}`,
    ),
    check('shift_templates_length_check', sql`(${t.endMinute} - ${t.startMinute} + 1440) % 1440 <= 1380`),
    check(
      'shift_templates_validity_check',
      sql`${t.validUntil} is null or ${t.validUntil} >= ${t.validFrom} - 1`,
    ),
    foreignKey({
      name: 'shift_templates_account_creator_fk',
      columns: [t.platformAccountId, t.creatorId],
      foreignColumns: [platformAccounts.id, platformAccounts.creatorId],
    }),
    index('shift_templates_creator_idx').on(t.creatorId),
    pgPolicy('member_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and (${plans} or ${isMine(t.memberId)})`,
    }),
    pgPolicy('team_insert', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${plans} and ${t.createdBy} = ${currentUser}`,
    }),
    pgPolicy('team_update', {
      for: 'update',
      using: sql`${t.creatorId} = ${currentCreator} and ${plans}`,
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${plans}`,
    }),
  ],
);

/**
 * A member's shift on one account, the half-open range [`starts_at`, `ends_at`) on whole minutes, a day at most. A
 * cancelled shift stays (`cancelled_at`), out of every read and of the exclusion constraints; `(template_id,
 * template_starts_at)` is unique, cancelled rows included, so a template never makes an occurrence twice, nor again
 * once it is cancelled or moved by hand.
 * A shift that has ended no longer changes, and its creator, account and template never do (triggers of the
 * migration).
 */
export const shifts = pgTable(
  'shifts',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platformAccountId: uuid('platform_account_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    startsAt: timestampTz('starts_at').notNull(),
    endsAt: timestampTz('ends_at').notNull(),
    templateId: uuid('template_id').references(() => shiftTemplates.id),
    /**
     * The start the template gave it, kept when a person moves the shift: with `template_id`, the occurrence it was
     * made for, so the template never makes that occurrence again.
     */
    templateStartsAt: timestampTz('template_starts_at'),
    cancelledAt: timestampTz('cancelled_at'),
    /** When a person stopped it under way: it ends at that minute, and the access window closes with it. */
    stoppedAt: timestampTz('stopped_at'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'shifts_range_check',
      sql`${t.endsAt} > ${t.startsAt} and ${t.endsAt} - ${t.startsAt} <= interval '24 hours'`,
    ),
    check(
      'shifts_whole_minutes_check',
      sql`date_trunc('minute', ${t.startsAt}) = ${t.startsAt} and date_trunc('minute', ${t.endsAt}) = ${t.endsAt}`,
    ),
    check(
      'shifts_stopped_check',
      sql`${t.stoppedAt} is null or ${t.endsAt} = date_trunc('minute', ${t.stoppedAt})`,
    ),
    foreignKey({
      name: 'shifts_account_creator_fk',
      columns: [t.platformAccountId, t.creatorId],
      foreignColumns: [platformAccounts.id, platformAccounts.creatorId],
    }),
    check('shifts_template_check', sql`(${t.templateId} is null) = (${t.templateStartsAt} is null)`),
    unique('shifts_template_occurrence_unique').on(t.templateId, t.templateStartsAt),
    /** For the swaps' composite keys: a swap names a shift with its creator, and the policies read that creator. */
    unique('shifts_id_creator_unique').on(t.id, t.creatorId),
    /** For the reports' key: a report is on its shift's creator, account and member, which never change once it started. */
    unique('shifts_report_key_unique').on(t.id, t.creatorId, t.platformAccountId, t.memberId),
    index('shifts_creator_start_idx').on(t.creatorId, t.startsAt),
    /** A member's shifts still to end: the access window of ADR 0025 reads them at every request. */
    index('shifts_member_end_idx')
      .on(t.memberId, t.endsAt)
      .where(sql`${t.cancelledAt} is null`),
    pgPolicy('member_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and (${plans} or ${isMine(t.memberId)})`,
    }),
    pgPolicy('team_insert', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${plans} and ${t.createdBy} = ${currentUser} and ${t.updatedBy} = ${currentUser}`,
    }),
    /**
     * The one policy that sets `cancelled_at` (`swap_update` keeps it null). The trigger that keeps a reported shift
     * from being cancelled reads the reports under the canceller's policies (migration 0026): a policy that lets a
     * member set it would make that read see the member's reports alone.
     */
    pgPolicy('team_update', {
      for: 'update',
      using: sql`${t.creatorId} = ${currentCreator} and ${plans}`,
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${plans} and ${t.updatedBy} = ${currentUser}`,
    }),
    /** The shifts a member's swaps name, proposed or accepted: the colleague asked reads the shift offered. */
    pgPolicy('swap_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and ${namedBySwapOfMine}`,
    }),
    /**
     * The colleague asked moves the shifts of the swap they accept: each to the other member of the swap, at the hours
     * the swap noted, neither cancelled nor stopped.
     */
    pgPolicy('swap_update', {
      for: 'update',
      using: sql`${t.creatorId} = ${currentCreator} and ${acceptedNowByMe(sql`s.shift_id = "shifts"."id" or s.target_shift_id = "shifts"."id"`)}`,
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${t.updatedBy} = ${currentUser} and ${t.cancelledAt} is null and ${t.stoppedAt} is null and ${acceptedNowByMe(
        sql`(s.shift_id = "shifts"."id" and "shifts"."member_id" = s.target_member_id and "shifts"."starts_at" = s.shift_starts_at and "shifts"."ends_at" = s.shift_ends_at) or (s.target_shift_id = "shifts"."id" and "shifts"."member_id" = s.requester_id and "shifts"."starts_at" = s.target_shift_starts_at and "shifts"."ends_at" = s.target_shift_ends_at)`,
      )}`,
    }),
  ],
);

export const LEAVE_REQUEST_STATUSES = ['pending', 'approved', 'refused', 'withdrawn', 'cancelled'] as const;

/**
 * A member's leave (ADR 0031): no creator, the policy of the team's tables. The member reads theirs, asks for their own
 * and withdraws it while pending; the owner and an active manager read all and decide, a manager never on their own
 * (the owner decides theirs). The instants are fixed when it is asked and never change: a leave cancelled under way
 * covers [`starts_at`, `cancelled_at`). Two pending or approved leaves of a member never overlap (exclusion constraint
 * of the migration), and a trigger keeps its columns and its states (`pending` → `approved` | `refused` | `withdrawn`,
 * `approved` → `cancelled` before its end).
 */
export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: id(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    firstDay: date('first_day').notNull(),
    lastDay: date('last_day').notNull(),
    timeZone: text('time_zone').notNull(),
    startsAt: timestampTz('starts_at').notNull(),
    endsAt: timestampTz('ends_at').notNull(),
    note: text('note'),
    status: text('status').notNull(),
    decidedAt: timestampTz('decided_at'),
    decidedBy: text('decided_by').references(() => user.id),
    decisionNote: text('decision_note'),
    cancelledAt: timestampTz('cancelled_at'),
    cancelledBy: text('cancelled_by').references(() => user.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('leave_requests', t.status, LEAVE_REQUEST_STATUSES),
    check(
      'leave_requests_days_check',
      sql`${t.lastDay} >= ${t.firstDay} and ${t.lastDay} - ${t.firstDay} < 31`,
    ),
    check('leave_requests_range_check', sql`${t.endsAt} > ${t.startsAt}`),
    check(
      'leave_requests_texts_check',
      sql`coalesce(char_length(${t.note}), 0) <= 500 and coalesce(char_length(${t.decisionNote}), 0) <= 500`,
    ),
    check(
      'leave_requests_state_check',
      sql`(${t.decidedAt} is null) = (${t.decidedBy} is null) and (${t.cancelledAt} is null) = (${t.cancelledBy} is null) and case ${t.status} when 'pending' then ${t.decidedAt} is null and ${t.cancelledAt} is null when 'approved' then ${t.decidedAt} is not null and ${t.cancelledAt} is null when 'refused' then ${t.decidedAt} is not null and ${t.cancelledAt} is null when 'withdrawn' then ${t.decidedAt} is null and ${t.cancelledAt} is not null else ${t.decidedAt} is not null and ${t.cancelledAt} is not null end`,
    ),
    index('leave_requests_member_start_idx').on(t.memberId, t.startsAt),
    pgPolicy('member_read', { for: 'select', using: sql`${plans} or ${isMine(t.memberId)}` }),
    pgPolicy('member_insert', {
      for: 'insert',
      withCheck: sql`${isMine(t.memberId)} and ${t.createdBy} = ${currentUser} and ${t.status} = 'pending'`,
    }),
    pgPolicy('member_withdraw', {
      for: 'update',
      using: sql`${isMine(t.memberId)} and ${t.status} = 'pending'`,
      withCheck: sql`${isMine(t.memberId)} and ${t.status} = 'withdrawn' and ${t.cancelledBy} = ${currentUser}`,
    }),
    pgPolicy('team_decide', {
      for: 'update',
      using: plans,
      withCheck: sql`${plans} and (${t.status} = 'cancelled' or ${isOwner} or not ${isMine(t.memberId)}) and ((${t.status} in ('approved', 'refused') and ${t.decidedBy} = ${currentUser}) or (${t.status} = 'cancelled' and ${t.cancelledBy} = ${currentUser}))`,
    }),
  ],
);

export const SHIFT_SWAP_STATUSES = [
  'proposed',
  'accepted',
  'declined',
  'withdrawn',
  'lapsed',
  'reverted',
] as const;

/**
 * A chatter's swap (ADR 0031): the requester's shift goes to the colleague, and with a target shift that one comes back.
 * It notes each shift's hours at the proposal: the acceptance moves them only if nothing changed, and the policy
 * `swap_update` of `shifts` holds the move to them. Read under the rule of ADR 0023: the creator of one of the two
 * shifts, and one of the two members or the scope `owner` | `agency`. Its policies never read `shifts`, whose
 * policies read it. One open proposal per (shift, colleague, shift asked back); a trigger keeps the columns and the
 * states (`proposed` → `accepted` | `declined` | `withdrawn` | `lapsed`, `accepted` → `reverted`). Every state but a
 * lapse names who resolved it; the job that lapses the proposals left behind by an acceptance is nobody.
 */
export const shiftSwapRequests = pgTable(
  'shift_swap_requests',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    shiftId: uuid('shift_id').notNull(),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => teamMembers.id),
    shiftStartsAt: timestampTz('shift_starts_at').notNull(),
    shiftEndsAt: timestampTz('shift_ends_at').notNull(),
    targetMemberId: uuid('target_member_id')
      .notNull()
      .references(() => teamMembers.id),
    targetCreatorId: uuid('target_creator_id').references(() => creators.id),
    targetShiftId: uuid('target_shift_id'),
    targetShiftStartsAt: timestampTz('target_shift_starts_at'),
    targetShiftEndsAt: timestampTz('target_shift_ends_at'),
    message: text('message'),
    status: text('status').notNull(),
    resolvedAt: timestampTz('resolved_at'),
    resolvedBy: text('resolved_by').references(() => user.id),
    revertedAt: timestampTz('reverted_at'),
    revertedBy: text('reverted_by').references(() => user.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('shift_swap_requests', t.status, SHIFT_SWAP_STATUSES),
    foreignKey({
      name: 'shift_swap_requests_shift_fk',
      columns: [t.shiftId, t.creatorId],
      foreignColumns: [shifts.id, shifts.creatorId],
    }),
    foreignKey({
      name: 'shift_swap_requests_target_shift_fk',
      columns: [t.targetShiftId, t.targetCreatorId],
      foreignColumns: [shifts.id, shifts.creatorId],
    }),
    check('shift_swap_requests_members_check', sql`${t.requesterId} <> ${t.targetMemberId}`),
    check(
      'shift_swap_requests_target_check',
      sql`num_nulls(${t.targetShiftId}, ${t.targetCreatorId}, ${t.targetShiftStartsAt}, ${t.targetShiftEndsAt}) in (0, 4) and ${t.targetShiftId} is distinct from ${t.shiftId}`,
    ),
    check('shift_swap_requests_message_check', sql`coalesce(char_length(${t.message}), 0) <= 500`),
    check(
      'shift_swap_requests_state_check',
      sql`(${t.resolvedBy} is null or ${t.resolvedAt} is not null) and (${t.resolvedBy} is not null or ${t.status} in ('proposed', 'lapsed')) and (${t.revertedAt} is null) = (${t.revertedBy} is null) and (${t.status} = 'proposed') = (${t.resolvedAt} is null) and (${t.status} = 'reverted') = (${t.revertedAt} is not null)`,
    ),
    uniqueIndex('shift_swap_requests_open_unique')
      .on(
        t.shiftId,
        t.targetMemberId,
        sql`coalesce(${t.targetShiftId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${t.status} = 'proposed'`),
    index('shift_swap_requests_shift_idx').on(t.shiftId),
    index('shift_swap_requests_target_shift_idx').on(t.targetShiftId),
    pgPolicy('swap_read', {
      for: 'select',
      using: sql`(${t.creatorId} = ${currentCreator} or ${t.targetCreatorId} = ${currentCreator}) and (${plans} or ${isMine(t.requesterId)} or ${isMine(t.targetMemberId)})`,
    }),
    pgPolicy('requester_insert', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${isMine(t.requesterId)} and ${t.createdBy} = ${currentUser} and ${t.status} = 'proposed'`,
    }),
    pgPolicy('requester_withdraw', {
      for: 'update',
      using: sql`(${t.creatorId} = ${currentCreator} or ${t.targetCreatorId} = ${currentCreator}) and ${isMine(t.requesterId)} and ${t.status} = 'proposed'`,
      withCheck: sql`${isMine(t.requesterId)} and ${t.status} in ('withdrawn', 'lapsed') and ${t.resolvedBy} = ${currentUser}`,
    }),
    pgPolicy('target_answer', {
      for: 'update',
      using: sql`(${t.creatorId} = ${currentCreator} or ${t.targetCreatorId} = ${currentCreator}) and ${isMine(t.targetMemberId)} and ${t.status} = 'proposed'`,
      withCheck: sql`${isMine(t.targetMemberId)} and ${t.status} in ('accepted', 'declined', 'lapsed') and ${t.resolvedBy} = ${currentUser}`,
    }),
    pgPolicy('team_update', {
      for: 'update',
      using: sql`(${t.creatorId} = ${currentCreator} or ${t.targetCreatorId} = ${currentCreator}) and ${plans}`,
      withCheck: sql`(${t.creatorId} = ${currentCreator} or ${t.targetCreatorId} = ${currentCreator}) and ${plans} and ((${t.status} in ('withdrawn', 'lapsed') and ${t.resolvedBy} = ${currentUser}) or (${t.status} = 'reverted' and ${t.revertedBy} = ${currentUser}))`,
    }),
  ],
);

/**
 * End-of-shift reports and their corrections (EQ-03, contracts `shift-reports.ts`), under the planning's rule: the
 * creator of `withTenantMember`, and the member himself or the scope `owner` | `agency`. A report sits on its shift's
 * creator, account and member (composite key), one per shift; a correction names a report of the same shift. The
 * member makes their report; the agency makes a correction (`by_agency`); the owner or an active manager reviews,
 * never a report of their own shift nor, as a manager, what they last sent (`submitted_by`). A trigger of the
 * migration keeps what never changes, makes each change take the next `version`, and lets a row move only
 * `submitted` → `submitted` | `validated` | `rejected` and `rejected` → `submitted`: a validated row never changes, a
 * review never touches the amount, and nothing is deleted.
 */
const isMaker: SQL = sql`((not "shift_reports"."by_agency" and ${isMine(sql`"shift_reports"."member_id"`)}) or ("shift_reports"."by_agency" and ${plans}))`;

export const shiftReports = pgTable(
  'shift_reports',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platformAccountId: uuid('platform_account_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => teamMembers.id),
    /** The pay period its shift starts in, in the agency's zone, as read when it was made. */
    period: date('period').notNull(),
    correctsId: uuid('corrects_id'),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    comment: text('comment'),
    incident: text('incident'),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    byAgency: boolean('by_agency').notNull().default(false),
    /** Who last sent it: made, changed, or sent again. */
    submittedBy: text('submitted_by')
      .notNull()
      .references(() => user.id),
    submittedAt: timestampTz('submitted_at').notNull(),
    reviewedBy: text('reviewed_by').references(() => user.id),
    reviewedAt: timestampTz('reviewed_at'),
    reviewNote: text('review_note'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'shift_reports_shift_fk',
      columns: [t.shiftId, t.creatorId, t.platformAccountId, t.memberId],
      foreignColumns: [shifts.id, shifts.creatorId, shifts.platformAccountId, shifts.memberId],
    }),
    /** For the corrections' key: a correction names a report of the same shift. */
    unique('shift_reports_id_shift_unique').on(t.id, t.shiftId),
    foreignKey({
      name: 'shift_reports_corrects_fk',
      columns: [t.correctsId, t.shiftId],
      foreignColumns: [t.id, t.shiftId],
    }),
    uniqueIndex('shift_reports_shift_unique')
      .on(t.shiftId)
      .where(sql`${t.correctsId} is null`),
    index('shift_reports_creator_period_idx').on(t.creatorId, t.period),
    index('shift_reports_member_period_idx').on(t.memberId, t.period),
    index('shift_reports_open_idx')
      .on(t.creatorId, t.submittedAt)
      .where(sql`${t.status} in ('submitted', 'rejected')`),
    enumCheck('shift_reports', t.status, SHIFT_REPORT_STATUSES),
    enumCheck('shift_reports', t.currency, CurrencySchema.options),
    check('shift_reports_period_check', sql`extract(day from ${t.period}) in (1, 16)`),
    check(
      'shift_reports_amount_check',
      sql`${t.amountMinor} between ${sql.raw(String(-SHIFT_REPORT_MAX_MINOR))} and ${sql.raw(String(SHIFT_REPORT_MAX_MINOR))} and case when ${t.correctsId} is null then ${t.amountMinor} >= 0 else ${t.amountMinor} <> 0 end`,
    ),
    check('shift_reports_correction_check', sql`${t.correctsId} is not null or (${t.byAgency} = false)`),
    check('shift_reports_incident_check', sql`${t.correctsId} is null or ${t.incident} is null`),
    check(
      'shift_reports_texts_check',
      sql`coalesce(char_length(${t.comment}), 1) between 1 and 1000 and coalesce(char_length(${t.incident}), 1) between 1 and 1000 and coalesce(char_length(${t.reviewNote}), 1) between 1 and 500`,
    ),
    check('shift_reports_version_check', sql`${t.version} >= 1`),
    check(
      'shift_reports_state_check',
      sql`(${t.reviewedAt} is null) = (${t.reviewedBy} is null) and (${t.status} = 'submitted') = (${t.reviewedAt} is null) and (${t.status} = 'rejected') = (${t.reviewNote} is not null)`,
    ),
    pgPolicy('member_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and (${plans} or ${isMine(t.memberId)})`,
    }),
    pgPolicy('member_insert', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${isMine(t.memberId)} and not ${t.byAgency} and ${t.status} = 'submitted' and ${t.version} = 1 and ${t.createdBy} = ${currentUser} and ${t.submittedBy} = ${currentUser}`,
    }),
    pgPolicy('agency_insert', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${plans} and ${t.byAgency} and ${t.correctsId} is not null and ${t.status} = 'submitted' and ${t.version} = 1 and ${t.createdBy} = ${currentUser} and ${t.submittedBy} = ${currentUser}`,
    }),
    pgPolicy('maker_update', {
      for: 'update',
      using: sql`${t.creatorId} = ${currentCreator} and ${t.status} in ('submitted', 'rejected') and ${isMaker}`,
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${t.status} = 'submitted' and ${t.submittedBy} = ${currentUser} and ${isMaker}`,
    }),
    pgPolicy('team_review', {
      for: 'update',
      using: sql`${t.creatorId} = ${currentCreator} and ${plans} and ${t.status} = 'submitted'`,
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${plans} and ${t.status} in ('validated', 'rejected') and ${t.reviewedBy} = ${currentUser} and not ${isMine(t.memberId)} and (${isOwner} or ${t.submittedBy} <> ${currentUser})`,
    }),
  ],
);
