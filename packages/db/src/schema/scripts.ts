import {
  CurrencySchema,
  MEDIA_SLOT_KINDS,
  PLATFORM_SCRIPT_MEDIA_ROLES,
  PLATFORM_SCRIPT_NAME_MAX,
  PLATFORM_SCRIPT_REF_MAX,
  PLATFORM_SCRIPT_STEP_MEDIA_MAX,
  PLATFORM_SCRIPT_STEP_TEXT_MAX,
  PLATFORM_SCRIPT_STEPS_MAX,
  PREPARED_SCRIPT_STATES,
  SCRIPT_IDENTITY_AUTHORS,
  PlatformScriptMomentSchema,
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
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { closedToCreator, createdAt, enumCheck, enumText, id, timestampTz, updatedAt } from './columns';
import { creators, platformAccounts } from './tenancy';

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

/**
 * The native scripts of each platform account (glossary « Script natif », ADR 0099 § 1 time 2, P6-01), mirrored by the
 * job `scripts.import_platform_scripts`: the platform is the source, Impera never writes one here. A script gone from
 * the platform is deactivated (`active` false, `deactivated_at`), never deleted: a run or a reward may still name it.
 * Under her RLS and the team's scopes (owner, active managers) for reading, closed to her account; written by the
 * job alone, as the service role (`withAdmin`).
 */
export const platformScripts = pgTable(
  'platform_scripts',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platformAccountId: uuid('platform_account_id').notNull(),
    /** The platform's own id: a sequence, or a step listed in no sequence (a script of one step). */
    platformScriptRef: text('platform_script_ref').notNull(),
    /** As the platform names it (« Un script importé garde le nom de Reveal »). */
    name: text('name').notNull(),
    /** Jour or Nuit as the connector reads it; `null` when nothing says it (`PlatformScript.moment`). */
    moment: enumText('moment'),
    /** `platformScriptFingerprint` of the last reading: the same fingerprint changed nothing. */
    fingerprint: text('fingerprint').notNull(),
    active: boolean('active').notNull().default(true),
    deactivatedAt: timestampTz('deactivated_at'),
    /** The last import that listed it. */
    syncedAt: timestampTz('synced_at').notNull(),
    /**
     * The import that wrote its current version: added, or rewritten because it changed on the platform (recette
     * 16/11). Since when a « Tarif réduit » on one of its steps keeps it from being offered.
     */
    versionAt: timestampTz('version_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'platform_scripts_account_creator_fk',
      columns: [t.platformAccountId, t.creatorId],
      foreignColumns: [platformAccounts.id, platformAccounts.creatorId],
    }),
    unique('platform_scripts_account_ref_unique').on(t.platformAccountId, t.platformScriptRef),
    /** The target of the steps' composite key: a step's script and creator always go together. */
    unique('platform_scripts_id_creator_unique').on(t.id, t.creatorId),
    index('platform_scripts_creator_idx').on(t.creatorId),
    enumCheck('platform_scripts', t.moment, PlatformScriptMomentSchema.options),
    check('platform_scripts_active_check', sql`${t.active} = (${t.deactivatedAt} is null)`),
    // The contract's bounds (`PLATFORM_SCRIPT_*_MAX`): the import cuts a name, and does not import a longer id.
    check(
      'platform_scripts_text_check',
      sql`char_length(${t.name}) <= ${sql.raw(String(PLATFORM_SCRIPT_NAME_MAX))} and char_length(${t.platformScriptRef}) <= ${sql.raw(String(PLATFORM_SCRIPT_REF_MAX))}`,
    ),
    pgPolicy('team_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and ${readsTeam}`,
    }),
    closedToCreator(),
  ],
);

/**
 * A step of a native script, at its place in the platform's order (`position` from 0, `stepIndex`, ADR 0099 § 3):
 * its text and its price read as the platform gives them (minor units, VAT included; 0 for an offered step), never
 * recalculated. Rewritten whole when its script changed on the platform.
 */
export const platformScriptSteps = pgTable(
  'platform_script_steps',
  {
    platformScriptId: uuid('platform_script_id').notNull(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    position: smallint('position').notNull(),
    /** What a send of this step names (`sendScriptStep`, `SentScriptStep.stepRef`). */
    platformStepRef: text('platform_step_ref').notNull(),
    /**
     * The platform's own rank of the step (`PlatformScriptStep.platformIndex`), kept as it is: two steps of a script on
     * the same rank are branches a human chooses between, never read one after the other (SC-04 c8).
     */
    platformIndex: integer('platform_index').notNull(),
    name: text('name').notNull(),
    text: text('text').notNull(),
    priceMinor: integer('price_minor').notNull(),
    /**
     * A « Tarif réduit » set on the platform (recette 16/11): its price and how long, as read; `null` when the step has
     * none (both `null`; Reveal gives both or neither, either one alone is a discount all the same). A step with one is
     * never sent, its script never offered: Impera never sells at a discount.
     */
    discountPriceMinor: integer('discount_price_minor'),
    discountMinutes: integer('discount_minutes'),
    currency: enumText('currency').notNull(),
  },
  (t) => [
    primaryKey({ name: 'platform_script_steps_pkey', columns: [t.platformScriptId, t.position] }),
    foreignKey({
      name: 'platform_script_steps_script_creator_fk',
      columns: [t.platformScriptId, t.creatorId],
      foreignColumns: [platformScripts.id, platformScripts.creatorId],
    }).onDelete('cascade'),
    index('platform_script_steps_creator_step_idx').on(t.creatorId, t.platformStepRef),
    check(
      'platform_script_steps_position_check',
      sql`${t.position} >= 0 and ${t.position} < ${sql.raw(String(PLATFORM_SCRIPT_STEPS_MAX))}`,
    ),
    check('platform_script_steps_platform_index_check', sql`${t.platformIndex} >= 0`),
    check(
      'platform_script_steps_text_check',
      sql`char_length(${t.name}) <= ${sql.raw(String(PLATFORM_SCRIPT_NAME_MAX))} and char_length(${t.text}) <= ${sql.raw(String(PLATFORM_SCRIPT_STEP_TEXT_MAX))} and char_length(${t.platformStepRef}) <= ${sql.raw(String(PLATFORM_SCRIPT_REF_MAX))}`,
    ),
    check('platform_script_steps_price_check', sql`${t.priceMinor} >= 0`),
    check(
      'platform_script_steps_discount_check',
      sql`coalesce(${t.discountPriceMinor}, 0) >= 0 and coalesce(${t.discountMinutes}, 0) >= 0`,
    ),
    enumCheck('platform_script_steps', t.currency, CurrencySchema.options),
    pgPolicy('team_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and ${readsTeam}`,
    }),
    closedToCreator(),
  ],
);

/**
 * The media a step sells (`sold`) and shows before it is bought (`preview`), in the platform's order, by the
 * platform's id of the vault media: the vault's link (`media_platform_refs`) says whether it is synced and which media
 * it is. A media absent from the vault leaves its step incomplete.
 */
export const platformScriptStepMedia = pgTable(
  'platform_script_step_media',
  {
    platformScriptId: uuid('platform_script_id').notNull(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    position: smallint('position').notNull(),
    role: enumText('role').notNull(),
    rank: smallint('rank').notNull(),
    platformMediaRef: text('platform_media_ref').notNull(),
    kind: enumText('kind').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'platform_script_step_media_pkey',
      columns: [t.platformScriptId, t.position, t.role, t.rank],
    }),
    foreignKey({
      name: 'platform_script_step_media_script_creator_fk',
      columns: [t.platformScriptId, t.creatorId],
      foreignColumns: [platformScripts.id, platformScripts.creatorId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'platform_script_step_media_step_fk',
      columns: [t.platformScriptId, t.position],
      foreignColumns: [platformScriptSteps.platformScriptId, platformScriptSteps.position],
    }).onDelete('cascade'),
    index('platform_script_step_media_creator_media_idx').on(t.creatorId, t.platformMediaRef),
    check(
      'platform_script_step_media_rank_check',
      sql`${t.rank} >= 0 and ${t.rank} < ${sql.raw(String(PLATFORM_SCRIPT_STEP_MEDIA_MAX))}`,
    ),
    check(
      'platform_script_step_media_ref_check',
      sql`char_length(${t.platformMediaRef}) <= ${sql.raw(String(PLATFORM_SCRIPT_REF_MAX))}`,
    ),
    enumCheck('platform_script_step_media', t.role, PLATFORM_SCRIPT_MEDIA_ROLES),
    enumCheck('platform_script_step_media', t.kind, MEDIA_SLOT_KINDS),
    pgPolicy('team_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and ${readsTeam}`,
    }),
    closedToCreator(),
  ],
);

/**
 * A native script's identity (SC-04 lot c8, ADR 0056 § 6): what it is and when it fits (`ScriptIdentityContent`), for
 * the version of the script it was written from (`input_hash`: its steps' names and texts, their media and the
 * validated description of each, never a price). Written by the brain (`scripts.identify_platform_script`, as the
 * service role) or by hand by the agency, a new row each time, validated once by a person and never changed after
 * (`script_identities_kept`). Under her RLS and the team's scopes, closed to her account; the brain never writes over a
 * validated identity of the same version.
 */
export const scriptIdentities = pgTable(
  'script_identities',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platformScriptId: uuid('platform_script_id').notNull(),
    /** sha256 of what it was written from: a change of text, media or description asks for a new one. */
    inputHash: text('input_hash').notNull(),
    /** `SCRIPT_IDENTITY_SCHEMA_VERSION` of its content. */
    schemaVersion: smallint('schema_version').notNull(),
    content: jsonb('content').notNull(),
    author: enumText('author').notNull(),
    /** The brain's model and prompt; `null` for a hand's. */
    model: text('model'),
    promptHash: text('prompt_hash'),
    /** Who validated it (ADR 0030 § 3): an account, set once with `validated_at`. */
    validatedBy: text('validated_by').references(() => user.id),
    validatedAt: timestampTz('validated_at'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'script_identities_script_creator_fk',
      columns: [t.platformScriptId, t.creatorId],
      foreignColumns: [platformScripts.id, platformScripts.creatorId],
    }),
    check('script_identities_validated_check', sql`(${t.validatedBy} is null) = (${t.validatedAt} is null)`),
    check('script_identities_input_hash_check', sql`${t.inputHash} ~ '^[0-9a-f]{64}$'`),
    check('script_identities_content_check', sql`jsonb_typeof(${t.content}) = 'object'`),
    check('script_identities_schema_version_check', sql`${t.schemaVersion} >= 1`),
    enumCheck('script_identities', t.author, SCRIPT_IDENTITY_AUTHORS),
    // The brain's says its model and prompt; a hand's is validated by its writer, nothing left to look at.
    check(
      'script_identities_writer_check',
      sql`case ${t.author} when 'brain' then ${t.model} is not null and ${t.promptHash} is not null else ${t.validatedAt} is not null and ${t.model} is null and ${t.promptHash} is null end`,
    ),
    // One by the brain per version and prompt: a replayed job writes nothing twice.
    uniqueIndex('script_identities_brain_unique')
      .on(t.platformScriptId, t.inputHash, t.promptHash)
      .where(sql`${t.author} = 'brain'`),
    index('script_identities_script_idx').on(t.creatorId, t.platformScriptId),
    pgPolicy('team_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and ${readsTeam}`,
    }),
    // Her team validates the identity shown, in its own name; only the two columns of the stamp are granted.
    pgPolicy('team_validate', {
      for: 'update',
      using: sql`${t.creatorId} = ${currentCreator} and ${readsTeam}`,
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${readsTeam} and ${t.validatedBy} = ${currentUser}`,
    }),
    // Her team writes one by hand: a row of its own, validated by the one who writes it.
    pgPolicy('team_correct', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${readsTeam} and ${t.author} = 'human' and ${t.validatedBy} = ${currentUser}`,
    }),
    closedToCreator(),
  ],
);

/**
 * What Impera holds of a branch of a native script that Reveal does not give (ADR 0112 § A 3): its place among the
 * branches of its step and its condition (`BranchCondition`), set by the agency in the CRM. Keyed by the branch's
 * `stepRef`, so that it outlives the import, which rewrites the steps; a row of a branch Reveal no longer lists is
 * ignored. Set a whole step at a time (rows of its branches deleted, then written) by the owner and the active managers
 * of her list, under her RLS, closed to her account.
 */
export const platformScriptBranches = pgTable(
  'platform_script_branches',
  {
    platformScriptId: uuid('platform_script_id').notNull(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platformStepRef: text('platform_step_ref').notNull(),
    branchOrder: smallint('branch_order').notNull(),
    /** `BranchConditionSchema`, read through it. */
    condition: jsonb('condition').notNull(),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'platform_script_branches_pkey', columns: [t.platformScriptId, t.platformStepRef] }),
    foreignKey({
      name: 'platform_script_branches_script_creator_fk',
      columns: [t.platformScriptId, t.creatorId],
      foreignColumns: [platformScripts.id, platformScripts.creatorId],
    }),
    index('platform_script_branches_creator_idx').on(t.creatorId, t.platformScriptId),
    check(
      'platform_script_branches_order_check',
      sql`${t.branchOrder} >= 0 and ${t.branchOrder} < ${sql.raw(String(PLATFORM_SCRIPT_STEPS_MAX))}`,
    ),
    check(
      'platform_script_branches_ref_check',
      sql`char_length(${t.platformStepRef}) <= ${sql.raw(String(PLATFORM_SCRIPT_REF_MAX))}`,
    ),
    check(
      'platform_script_branches_condition_check',
      sql`jsonb_typeof(${t.condition}) = 'object' and ${t.condition}->>'kind' in ('none', 'structured', 'text')`,
    ),
    pgPolicy('team_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and ${readsTeam}`,
    }),
    pgPolicy('team_write', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${readsTeam} and ${t.updatedBy} = ${currentUser}`,
    }),
    pgPolicy('team_clear', {
      for: 'delete',
      using: sql`${t.creatorId} = ${currentCreator} and ${readsTeam}`,
    }),
    closedToCreator(),
  ],
);

/**
 * Scripts in preparation (ADR 0112 §§ 20-23, « script en préparation »): written in Impera's editor, not at Reveal yet,
 * never offered nor sent. `content` is `PreparedScriptContentSchema`, read through it; `revision` rises with each save,
 * and a save names the one it was made on. Written by the owner and the active managers of her list, under her RLS,
 * closed to her account; never deleted. The import that recognises it (§ 23) marks it `matched` as the service role.
 */
export const preparedScripts = pgTable(
  'prepared_scripts',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    /** The Reveal account it is to be copied into. */
    platformAccountId: uuid('platform_account_id').notNull(),
    state: enumText('state').notNull().default('editing'),
    revision: integer('revision').notNull().default(1),
    content: jsonb('content').notNull(),
    /** The native script it became; set with `matched` only. */
    matchedPlatformScriptId: uuid('matched_platform_script_id'),
    matchedAt: timestampTz('matched_at'),
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
    foreignKey({
      name: 'prepared_scripts_account_creator_fk',
      columns: [t.platformAccountId, t.creatorId],
      foreignColumns: [platformAccounts.id, platformAccounts.creatorId],
    }),
    foreignKey({
      name: 'prepared_scripts_matched_creator_fk',
      columns: [t.matchedPlatformScriptId, t.creatorId],
      foreignColumns: [platformScripts.id, platformScripts.creatorId],
    }),
    index('prepared_scripts_creator_idx').on(t.creatorId, t.updatedAt),
    enumCheck('prepared_scripts', t.state, PREPARED_SCRIPT_STATES),
    check('prepared_scripts_revision_check', sql`${t.revision} >= 1`),
    check(
      'prepared_scripts_matched_check',
      sql`(${t.state} = 'matched') = (${t.matchedPlatformScriptId} is not null and ${t.matchedAt} is not null)`,
    ),
    check(
      'prepared_scripts_content_check',
      sql`jsonb_typeof(${t.content}) = 'object' and jsonb_typeof(${t.content}->'steps') = 'array'`,
    ),
    pgPolicy('team_read', {
      for: 'select',
      using: sql`${t.creatorId} = ${currentCreator} and ${readsTeam}`,
    }),
    pgPolicy('team_write', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${readsTeam} and ${t.createdBy} = ${currentUser} and ${t.updatedBy} = ${currentUser} and ${t.state} = 'editing'`,
    }),
    pgPolicy('team_update', {
      for: 'update',
      using: sql`${t.creatorId} = ${currentCreator} and ${readsTeam} and ${t.state} <> 'matched'`,
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${readsTeam} and ${t.updatedBy} = ${currentUser} and ${t.state} <> 'matched'`,
    }),
    closedToCreator(),
  ],
);
