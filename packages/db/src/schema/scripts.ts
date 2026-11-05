import {
  SCRIPT_CADENCE_DEFAULT_DAYS,
  SCRIPT_CADENCE_MAX_DAYS,
  SCRIPT_CADENCE_MIN_DAYS,
  SCRIPT_CADENCE_OUTCOMES,
  SCRIPT_MOMENTS,
  SCRIPT_QUEUE_MAX,
  SCRIPT_STRUCTURE_NAME_MAX,
} from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { closedToCreator, createdAt, enumCheck, enumText, id, timestampTz, updatedAt } from './columns';
import { creators } from './tenancy';

/**
 * Script structures (ADR 0056 § 1, SC-01), owned by the `scripts` module. The library is the agency's: out of the
 * creators' RLS, under the team's policies (`withMember`): the owner and the active managers read it, the owner alone
 * writes. The queue is per creator: under her RLS and the same scopes (`withTenantMember`), so that an account of hers
 * reads none of it; all three are also closed to her account outright (`creator_closed`, CR-02). A version asked of her is frozen: a trigger refuses any change to it, and its removal, whoever asks.
 */

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const readsTeam: SQL = sql`${currentScope} in ('owner', 'agency')`;
const isOwner: SQL = sql`${currentScope} = 'owner'`;

/** A structure: what does not change from one version to the next. Archived, never deleted: a request keeps naming it. */
export const scriptStructures = pgTable(
  'script_structures',
  {
    id: id(),
    /** Kept for one creator, asked of her alone; `null`: any creator. */
    reservedCreatorId: uuid('reserved_creator_id').references(() => creators.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    archivedAt: timestampTz('archived_at'),
  },
  (t) => [
    check(
      'script_structures_archived_check',
      sql`${t.archivedAt} is null or ${t.archivedAt} >= ${t.createdAt}`,
    ),
    pgPolicy('team_read', { for: 'select', using: readsTeam }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${isOwner} and ${t.createdBy} = ${currentUser}`,
    }),
    pgPolicy('owner_update', { for: 'update', using: isOwner, withCheck: isOwner }),
    closedToCreator(),
  ],
);

/**
 * One version of a structure: its name, its moment, its colour and its segments (`ScriptSegment[]`, read back through the
 * contract). The latest is changed in place until it is frozen (`frozen_at`); then a change is the next version.
 */
export const scriptStructureVersions = pgTable(
  'script_structure_versions',
  {
    id: id(),
    structureId: uuid('structure_id')
      .notNull()
      .references(() => scriptStructures.id),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    moment: enumText('moment').notNull(),
    segments: jsonb('segments').notNull(),
    /** Its colour, three tones (`ScriptColor`, ADR 0064): the versions written before it took the « Rouge » preset. */
    color: jsonb('color')
      .notNull()
      .default(sql`'{"primary":"#b0213a","secondary":"#c8283f","accent":"#d8324b"}'::jsonb`),
    /** Asked of a creator, or being shot (SC-02): never changed nor removed again. */
    frozenAt: timestampTz('frozen_at'),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('script_structure_versions_number_unique').on(t.structureId, t.version),
    check('script_structure_versions_version_check', sql`${t.version} >= 1`),
    check(
      'script_structure_versions_name_check',
      sql`char_length(${t.name}) between 1 and ${sql.raw(String(SCRIPT_STRUCTURE_NAME_MAX))}`,
    ),
    check(
      'script_structure_versions_segments_check',
      sql`jsonb_typeof(${t.segments}) = 'array' and jsonb_array_length(${t.segments}) >= 1`,
    ),
    check('script_structure_versions_color_check', sql`jsonb_typeof(${t.color}) = 'object'`),
    enumCheck('script_structure_versions', t.moment, SCRIPT_MOMENTS),
    pgPolicy('team_read', { for: 'select', using: readsTeam }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${isOwner} and ${t.updatedBy} = ${currentUser}`,
    }),
    pgPolicy('owner_update', {
      for: 'update',
      using: isOwner,
      withCheck: sql`${isOwner} and ${t.updatedBy} = ${currentUser}`,
    }),
    closedToCreator(),
  ],
);

/** The structures to ask of one creator next, in order (ADR 0056 § 2); replaced whole by the owner. */
export const scriptStructureQueue = pgTable(
  'script_structure_queue',
  {
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    position: smallint('position').notNull(),
    structureId: uuid('structure_id')
      .notNull()
      .references(() => scriptStructures.id),
    addedBy: text('added_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'script_structure_queue_pkey', columns: [t.creatorId, t.position] }),
    unique('script_structure_queue_structure_unique').on(t.creatorId, t.structureId),
    index('script_structure_queue_structure_idx').on(t.structureId),
    check(
      'script_structure_queue_position_check',
      sql`${t.position} between 1 and ${sql.raw(String(SCRIPT_QUEUE_MAX))}`,
    ),
    pgPolicy('team_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and ${readsTeam}`,
    }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${isOwner} and ${t.addedBy} = ${currentUser}`,
    }),
    pgPolicy('owner_delete', {
      for: 'delete',
      using: sql`${t.creatorId} = ${currentCreator} and ${isOwner}`,
    }),
    closedToCreator(),
  ],
);

/**
 * Each creator's script cadence (SC-02, ADR 0056 § 2): every how many days a script is asked of her, and what the hourly
 * job `scripts.ask_scripts` last found (`outcome`, `skipped`: the structures it passed over because they touch her
 * limits). No row: 14 days, never checked. Under her RLS and the team's scopes; the job writes it as the admin role.
 */
export const scriptCadences = pgTable(
  'script_cadences',
  {
    creatorId: uuid('creator_id')
      .primaryKey()
      .references(() => creators.id),
    days: smallint('days').notNull().default(SCRIPT_CADENCE_DEFAULT_DAYS),
    outcome: enumText('outcome'),
    /** `ScriptCadenceSkip[]`, read back through the contract. */
    skipped: jsonb('skipped')
      .notNull()
      .default(sql`'[]'::jsonb`),
    checkedAt: timestampTz('checked_at'),
    updatedBy: text('updated_by').references(() => user.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'script_cadences_days_check',
      sql`${t.days} between ${sql.raw(String(SCRIPT_CADENCE_MIN_DAYS))} and ${sql.raw(String(SCRIPT_CADENCE_MAX_DAYS))}`,
    ),
    check('script_cadences_skipped_check', sql`jsonb_typeof(${t.skipped}) = 'array'`),
    check('script_cadences_checked_check', sql`(${t.outcome} is null) = (${t.checkedAt} is null)`),
    enumCheck('script_cadences', t.outcome, SCRIPT_CADENCE_OUTCOMES),
    pgPolicy('team_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and ${readsTeam}`,
    }),
    pgPolicy('owner_insert', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${isOwner} and ${t.updatedBy} = ${currentUser}`,
    }),
    pgPolicy('owner_update', {
      for: 'update',
      using: sql`${t.creatorId} = ${currentCreator} and ${isOwner}`,
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${isOwner} and ${t.updatedBy} = ${currentUser}`,
    }),
    closedToCreator(),
  ],
);
