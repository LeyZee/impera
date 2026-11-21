import {
  CREATOR_TASK_CATEGORIES,
  CREATOR_TASK_KINDS,
  DAY_ITEMS,
  DAY_TARGET_MAX,
  SUGGESTION_ORIGINS,
  SUGGESTION_STATES,
  WEEK_NEEDS,
  WEEK_ROLES,
} from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  type PgColumn,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, enumCheck, enumText, id, timestampTz, updatedAt } from './columns';
import { contentRequests } from './content-drops';
import { creators } from './tenancy';

/*
 * Her agenda (CR-05, ADR 0042 § 3 and § 4, contracts `creator-tasks.ts`). Her tasks, her ticks and her dispos are hers:
 * she reads and writes them in her own account (`withCreatorAccount`), and the owner and an active manager read them
 * (`withTenantMember`), to place a suggestion and see what she did of it. A suggestion is the agency's: written by the
 * owner or an active manager (or a job, `withAdmin`), read and decided by her. Nothing is ever deleted but a tick she
 * takes back: a task or a dispo she removes is archived.
 */

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const isCreatorAccount: SQL = sql`current_setting('app.account_role', true) = 'creator'`;
const notCreatorAccount: SQL = sql`current_setting('app.account_role', true) is distinct from 'creator'`;
const readsTeam: SQL = sql`${notCreatorAccount} and ${currentScope} in ('owner', 'agency')`;
const hers = (creatorId: PgColumn): SQL => sql`${isCreatorAccount} and ${creatorId} = ${currentCreator}`;
const ofHerTeam = (creatorId: PgColumn): SQL => sql`${readsTeam} and ${creatorId} = ${currentCreator}`;
/** Her week of shooting is the owner's alone to write (ADR 0140 § 3): a manager reads it. */
const ofHerOwner = (creatorId: PgColumn): SQL =>
  sql`${notCreatorAccount} and ${currentScope} = 'owner' and ${creatorId} = ${currentCreator}`;

/** The shape each kind takes: a start and an end, a day, or weekdays (1 Monday … 7 Sunday, each once). */
const whenShape = (t: {
  kind: unknown;
  startsAt: unknown;
  endsAt: unknown;
  day: unknown;
  weekdays: unknown;
}): SQL => sql`(
  (${t.kind} = 'timed' and ${t.startsAt} is not null and ${t.endsAt} > ${t.startsAt}
    and ${t.endsAt} - ${t.startsAt} <= interval '1 day' and ${t.day} is null and ${t.weekdays} is null)
  or (${t.kind} = 'day' and ${t.day} is not null and ${t.startsAt} is null and ${t.endsAt} is null and ${t.weekdays} is null)
  or (${t.kind} = 'routine' and ${t.weekdays} is not null and cardinality(${t.weekdays}) between 1 and 7
    and ${t.weekdays} <@ array[1, 2, 3, 4, 5, 6, 7] and ${t.startsAt} is null and ${t.endsAt} is null and ${t.day} is null)
)`;

/**
 * One of her tasks. `essential` is the agency's routine she accepted (a suggestion behind it): it counts for her
 * streak, hers does not (glossary « Routine »). Archived, it leaves her agenda and keeps its ticks.
 */
export const creatorTasks = pgTable(
  'creator_tasks',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    kind: enumText('kind').notNull(),
    category: enumText('category').notNull(),
    title: text('title').notNull(),
    purpose: text('purpose'),
    /** Her shooting sheet, copied once from the suggestion she accepted (VEI-01 d); out of her UPDATE grant. */
    shootBrief: text('shoot_brief'),
    /** Her reel sheet (`ReelBriefSchema`, ADR 0082 § 3), copied with it; parsed on write and on read. */
    reelBrief: jsonb('reel_brief'),
    startsAt: timestampTz('starts_at'),
    endsAt: timestampTz('ends_at'),
    day: date('day', { mode: 'string' }),
    weekdays: integer('weekdays').array(),
    essential: boolean('essential').notNull().default(false),
    reminderMinutes: integer('reminder_minutes'),
    /** The suggestion she accepted, of her own creator (`creator_tasks_suggestion_fk`), written with it in one transaction. */
    suggestionId: uuid('suggestion_id'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    archivedAt: timestampTz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // Typed by hand: the two tables point to each other, which Drizzle cannot infer.
  (t): PgTableExtraConfigValue[] => [
    enumCheck('creator_tasks', t.kind, CREATOR_TASK_KINDS),
    enumCheck('creator_tasks', t.category, CREATOR_TASK_CATEGORIES),
    check('creator_tasks_when_check', whenShape(t)),
    check('creator_tasks_title_check', sql`char_length(${t.title}) between 1 and 80`),
    check(
      'creator_tasks_purpose_check',
      sql`${t.purpose} is null or char_length(${t.purpose}) between 1 and 160`,
    ),
    check(
      'creator_tasks_shoot_brief_check',
      sql`${t.shootBrief} is null or char_length(${t.shootBrief}) between 1 and 600`,
    ),
    check(
      'creator_tasks_reel_brief_check',
      sql`${t.reelBrief} is null or jsonb_typeof(${t.reelBrief}) = 'object'`,
    ),
    check(
      'creator_tasks_reminder_check',
      sql`${t.reminderMinutes} is null or (${t.kind} = 'timed' and ${t.reminderMinutes} between 0 and 1440)`,
    ),
    check(
      'creator_tasks_essential_check',
      sql`not ${t.essential} or (${t.kind} = 'routine' and ${t.suggestionId} is not null)`,
    ),
    unique('creator_tasks_suggestion_unique').on(t.suggestionId),
    // The pair a tick and a suggestion point to, so that neither names a task of another creator.
    unique('creator_tasks_creator_unique').on(t.id, t.creatorId),
    // An essential task comes from a suggestion of her own creator, never from an id she would make up (Bilan, #497).
    foreignKey({
      name: 'creator_tasks_suggestion_fk',
      columns: [t.suggestionId, t.creatorId],
      foreignColumns: [creatorSuggestions.id, creatorSuggestions.creatorId],
    }),
    index('creator_tasks_creator_starts_idx').on(t.creatorId, t.startsAt),
    index('creator_tasks_creator_day_idx').on(t.creatorId, t.day),
    pgPolicy('creator_read', { for: 'select', using: hers(t.creatorId) }),
    // An essential task only from a routine suggestion of hers still to decide: the acceptance writes both.
    pgPolicy('creator_insert', {
      for: 'insert',
      withCheck: sql`${hers(t.creatorId)} and ${t.createdBy} = ${currentUser} and (not ${t.essential} or exists (
        select 1 from creator_suggestions s
         where s.id = ${t.suggestionId} and s.creator_id = ${t.creatorId} and s.kind = 'routine' and s.state = 'suggested'
      ))`,
    }),
    pgPolicy('creator_update', { for: 'update', using: hers(t.creatorId), withCheck: hers(t.creatorId) }),
    pgPolicy('team_read', { for: 'select', using: ofHerTeam(t.creatorId) }),
  ],
);

/** A tick: one of her tasks done on one of her days, once (`creator_task_ticks_unique`). She takes it back by deleting it. */
export const creatorTaskTicks = pgTable(
  'creator_task_ticks',
  {
    taskId: uuid('task_id').notNull(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    day: date('day', { mode: 'string' }).notNull(),
    doneAt: timestampTz('done_at').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('creator_task_ticks_unique').on(t.taskId, t.day),
    foreignKey({
      name: 'creator_task_ticks_task_fk',
      columns: [t.taskId, t.creatorId],
      foreignColumns: [creatorTasks.id, creatorTasks.creatorId],
    }),
    index('creator_task_ticks_creator_day_idx').on(t.creatorId, t.day),
    pgPolicy('creator_read', { for: 'select', using: hers(t.creatorId) }),
    pgPolicy('creator_insert', {
      for: 'insert',
      withCheck: sql`${hers(t.creatorId)} and ${t.createdBy} = ${currentUser}`,
    }),
    pgPolicy('creator_delete', { for: 'delete', using: hers(t.creatorId) }),
    pgPolicy('team_read', { for: 'select', using: ofHerTeam(t.creatorId) }),
  ],
);

/** A dispo she opens to the agency: weekly in her wall-clock time (an end at or before its start is the next day's, as a créneau's), or once. */
export const creatorAvailabilities = pgTable(
  'creator_availabilities',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    kind: enumText('kind').notNull(),
    weekday: integer('weekday'),
    startMinute: integer('start_minute'),
    endMinute: integer('end_minute'),
    startsAt: timestampTz('starts_at'),
    endsAt: timestampTz('ends_at'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    archivedAt: timestampTz('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('creator_availabilities', t.kind, ['weekly', 'once']),
    check(
      'creator_availabilities_when_check',
      sql`(
        ${t.kind} = 'weekly' and ${t.weekday} between 1 and 7 and ${t.startMinute} between 0 and 1439
          and ${t.endMinute} between 0 and 1439
          and ${t.startsAt} is null and ${t.endsAt} is null
      ) or (
        ${t.kind} = 'once' and ${t.endsAt} > ${t.startsAt} and ${t.endsAt} - ${t.startsAt} <= interval '1 day'
          and ${t.weekday} is null and ${t.startMinute} is null and ${t.endMinute} is null
      )`,
    ),
    index('creator_availabilities_creator_idx').on(t.creatorId),
    pgPolicy('creator_read', { for: 'select', using: hers(t.creatorId) }),
    pgPolicy('creator_insert', {
      for: 'insert',
      withCheck: sql`${hers(t.creatorId)} and ${t.createdBy} = ${currentUser}`,
    }),
    pgPolicy('creator_update', { for: 'update', using: hers(t.creatorId), withCheck: hers(t.creatorId) }),
    pgPolicy('team_read', { for: 'select', using: ofHerTeam(t.creatorId) }),
  ],
);

/**
 * A suggestion for her agenda (ADR 0042 § 3): the agency's or the AI's, which she never reads. Timed and undated when
 * it found no room (`starts_at` null, `minutes` kept). `decided_on` is her day of the decision, which the rule of the
 * week after reads (`maySuggest`); `task_id` the task an acceptance made.
 */
export const creatorSuggestions = pgTable(
  'creator_suggestions',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    origin: enumText('origin').notNull(),
    kind: enumText('kind').notNull(),
    category: enumText('category').notNull(),
    title: text('title').notNull(),
    purpose: text('purpose'),
    /** The shooting sheet the agency wrote (an idea's « à tourner », VEI-01 d). */
    shootBrief: text('shoot_brief'),
    /** The reel sheet beside it (`ReelBriefSchema`, ADR 0082 § 3); parsed on write and on read. */
    reelBrief: jsonb('reel_brief'),
    startsAt: timestampTz('starts_at'),
    endsAt: timestampTz('ends_at'),
    day: date('day', { mode: 'string' }),
    weekdays: integer('weekdays').array(),
    minutes: integer('minutes'),
    week: date('week', { mode: 'string' }).notNull(),
    /**
     * A « Jour de tournage » or « Livrer ma semaine » of her week (ADR 0140 § 7), written when the owner validates it;
     * `null` for any other suggestion. Its id is drawn from (her, the week, the role, the day): a replay writes nothing.
     */
    weekRole: enumText('week_role'),
    state: enumText('state').notNull().default('suggested'),
    reason: text('reason'),
    decidedAt: timestampTz('decided_at'),
    decidedOn: date('decided_on', { mode: 'string' }),
    taskId: uuid('task_id'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    enumCheck('creator_suggestions', t.origin, SUGGESTION_ORIGINS),
    enumCheck('creator_suggestions', t.kind, CREATOR_TASK_KINDS),
    enumCheck('creator_suggestions', t.category, CREATOR_TASK_CATEGORIES),
    enumCheck('creator_suggestions', t.state, SUGGESTION_STATES),
    enumCheck('creator_suggestions', t.weekRole, WEEK_ROLES),
    // A frame of her week is a task of a day, never a task with hours (ADR 0140 § 2): it never meets her timed tasks.
    check(
      'creator_suggestions_week_role_shape_check',
      sql`${t.weekRole} is null or (${t.kind} = 'day' and ${t.category} = 'shoot')`,
    ),
    check(
      'creator_suggestions_when_check',
      sql`(${t.kind} = 'timed' and ${t.startsAt} is null and ${t.endsAt} is null and ${t.day} is null and ${t.weekdays} is null)
        or ${whenShape(t)}`,
    ),
    check(
      'creator_suggestions_minutes_check',
      sql`(${t.kind} = 'timed') = (${t.minutes} is not null) and coalesce(${t.minutes}, 1) between 1 and 1440`,
    ),
    check('creator_suggestions_title_check', sql`char_length(${t.title}) between 1 and 80`),
    check(
      'creator_suggestions_purpose_check',
      sql`${t.purpose} is null or char_length(${t.purpose}) between 1 and 160`,
    ),
    check(
      'creator_suggestions_shoot_brief_check',
      sql`${t.shootBrief} is null or char_length(${t.shootBrief}) between 1 and 600`,
    ),
    check(
      'creator_suggestions_reel_brief_check',
      sql`${t.reelBrief} is null or jsonb_typeof(${t.reelBrief}) = 'object'`,
    ),
    check(
      'creator_suggestions_reason_check',
      sql`${t.reason} is null or (${t.state} = 'declined' and char_length(${t.reason}) between 1 and 200)`,
    ),
    check('creator_suggestions_week_check', sql`extract(isodow from ${t.week}) = 1`),
    check(
      'creator_suggestions_decision_check',
      sql`(${t.state} = 'suggested') = (${t.decidedAt} is null and ${t.decidedOn} is null)
        and (${t.state} = 'accepted') = (${t.taskId} is not null)`,
    ),
    check('creator_suggestions_author_check', sql`(${t.origin} = 'agency') = (${t.createdBy} is not null)`),
    index('creator_suggestions_creator_week_idx').on(t.creatorId, t.week),
    unique('creator_suggestions_creator_unique').on(t.id, t.creatorId),
    foreignKey({
      name: 'creator_suggestions_task_fk',
      columns: [t.taskId, t.creatorId],
      foreignColumns: [creatorTasks.id, creatorTasks.creatorId],
    }),
    pgPolicy('creator_read', { for: 'select', using: hers(t.creatorId) }),
    pgPolicy('creator_decide', { for: 'update', using: hers(t.creatorId), withCheck: hers(t.creatorId) }),
    pgPolicy('team_read', { for: 'select', using: ofHerTeam(t.creatorId) }),
    pgPolicy('team_insert', {
      for: 'insert',
      // A frame of her week (`week_role`) is the owner's alone; any other suggestion, the owner's or a manager's.
      withCheck: sql`${ofHerTeam(t.creatorId)} and ${t.origin} = 'agency' and ${t.createdBy} = ${currentUser}
        and (${t.weekRole} is null or ${currentScope} = 'owner')`,
    }),
  ],
);

/**
 * One line of a « Jour de tournage » (ADR 0140 § 24): what there is to shoot that day, written with its suggestion when
 * the owner validates her week, never by her. She only ticks it (`done_at`, `done_by`: her column grant), once she has
 * accepted the day; the day's task is done when all its lines are. Never deleted.
 */
export const creatorShootItems = pgTable(
  'creator_shoot_items',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    suggestionId: uuid('suggestion_id').notNull(),
    position: integer('position').notNull(),
    need: enumText('need').notNull(),
    label: text('label').notNull(),
    sheet: text('sheet'),
    count: integer('count').notNull(),
    /** The script request the line answers (ADR 0055 § 4), `null` for any other need. */
    requestId: uuid('request_id'),
    doneAt: timestampTz('done_at'),
    doneBy: text('done_by').references(() => user.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('creator_shoot_items', t.need, WEEK_NEEDS),
    check('creator_shoot_items_label_check', sql`char_length(${t.label}) between 1 and 120`),
    check(
      'creator_shoot_items_sheet_check',
      sql`${t.sheet} is null or char_length(${t.sheet}) between 1 and 600`,
    ),
    check('creator_shoot_items_count_check', sql`${t.count} between 1 and 50`),
    check('creator_shoot_items_position_check', sql`${t.position} between 0 and 19`),
    check('creator_shoot_items_request_check', sql`${t.requestId} is null or ${t.need} = 'script'`),
    check('creator_shoot_items_done_check', sql`(${t.doneAt} is null) = (${t.doneBy} is null)`),
    unique('creator_shoot_items_position_unique').on(t.suggestionId, t.position),
    // Her suggestion, never another creator's.
    foreignKey({
      name: 'creator_shoot_items_suggestion_fk',
      columns: [t.suggestionId, t.creatorId],
      foreignColumns: [creatorSuggestions.id, creatorSuggestions.creatorId],
    }),
    foreignKey({
      name: 'creator_shoot_items_request_fk',
      columns: [t.requestId, t.creatorId],
      foreignColumns: [contentRequests.id, contentRequests.creatorId],
    }),
    index('creator_shoot_items_creator_idx').on(t.creatorId),
    pgPolicy('creator_read', { for: 'select', using: hers(t.creatorId) }),
    // Her tick, on a day she accepted: the line's suggestion became one of her tasks.
    pgPolicy('creator_tick', {
      for: 'update',
      using: sql`${hers(t.creatorId)} and exists (
        select 1 from creator_suggestions s
         where s.id = ${t.suggestionId} and s.creator_id = ${t.creatorId} and s.state = 'accepted'
      )`,
      withCheck: sql`${hers(t.creatorId)} and (${t.doneBy} is null or ${t.doneBy} = ${currentUser})`,
    }),
    pgPolicy('team_read', { for: 'select', using: ofHerTeam(t.creatorId) }),
    // Written by the owner with the shooting day he validates, still to decide.
    pgPolicy('team_insert', {
      for: 'insert',
      withCheck: sql`${ofHerOwner(t.creatorId)} and ${t.createdBy} = ${currentUser} and ${t.doneAt} is null
        and exists (
          select 1 from creator_suggestions s
           where s.id = ${t.suggestionId} and s.creator_id = ${t.creatorId} and s.week_role = 'shoot_day'
             and s.state = 'suggested'
        )`,
    }),
  ],
);

/**
 * Her day (ADR 0140, second avenant of 20/11/2026): how many of a line of her day she did (`DAY_ITEMS`: her Reveal
 * story, her Instagram posts…), one row a day and a line, written by her alone, today or yesterday in her zone (checked
 * by the code). What a line asks is the code's, never stored. Read by her team; never deleted.
 */
export const creatorDayTicks = pgTable(
  'creator_day_ticks',
  {
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    day: date('day', { mode: 'string' }).notNull(),
    item: enumText('item').notNull(),
    done: integer('done').notNull(),
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
    enumCheck('creator_day_ticks', t.item, DAY_ITEMS),
    check('creator_day_ticks_done_check', sql`${t.done} between 0 and ${sql.raw(String(DAY_TARGET_MAX))}`),
    primaryKey({ name: 'creator_day_ticks_pkey', columns: [t.creatorId, t.day, t.item] }),
    pgPolicy('creator_read', { for: 'select', using: hers(t.creatorId) }),
    pgPolicy('creator_insert', {
      for: 'insert',
      withCheck: sql`${hers(t.creatorId)} and ${t.createdBy} = ${currentUser} and ${t.updatedBy} = ${currentUser}`,
    }),
    pgPolicy('creator_update', {
      for: 'update',
      using: hers(t.creatorId),
      withCheck: sql`${hers(t.creatorId)} and ${t.updatedBy} = ${currentUser}`,
    }),
    pgPolicy('team_read', { for: 'select', using: ofHerTeam(t.creatorId) }),
  ],
);
