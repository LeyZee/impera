import {
  CONTENT_REQUEST_ORIGINS,
  CONTENT_REQUEST_STATES,
  DROP_CATEGORIES,
  DROP_FILE_STATES,
  DROP_MEDIA_KINDS,
  DROP_MIME_TYPES,
  DROP_STATES,
} from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
  type PgColumn,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, enumCheck, enumText, id, timestampTz, updatedAt } from './columns';
import { mediaAssets } from './media';
import { scriptStructureVersions, scriptStructures } from './scripts';
import { creators } from './tenancy';

/*
 * Her drops and what the agency asks of her (CR-06, ADR 0044 § 1, ADR 0055, contracts `content-drops.ts`). She reads
 * her own in her account (`withCreatorAccount`) and writes only three things: a drop with its files, the withdrawal of
 * a drop nothing has scheduled yet, her refusal of a request (the triggers of the migration hold her to those columns).
 * The owner and an active manager (`withTenantMember`) read everything of hers, drop for her, correct a category,
 * withdraw a drop, ask and cancel. A job (`withAdmin`) moves the files and the states. Nothing is ever deleted.
 */

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const isCreatorAccount: SQL = sql`current_setting('app.account_role', true) = 'creator'`;
const notCreatorAccount: SQL = sql`current_setting('app.account_role', true) is distinct from 'creator'`;
const readsTeam: SQL = sql`${notCreatorAccount} and ${currentScope} in ('owner', 'agency')`;
const hers = (creatorId: PgColumn): SQL => sql`${isCreatorAccount} and ${creatorId} = ${currentCreator}`;
const ofHerTeam = (creatorId: PgColumn): SQL => sql`${readsTeam} and ${creatorId} = ${currentCreator}`;

/**
 * What the agency asks of her (ADR 0055 § 4): a category, a day, a reason, and for a script its structure. Born by
 * hand (`agency`, its author) or from the code (`stock`, `cadence`, no author). Satisfied by a drop not withdrawn
 * (`content_drops.request_id`), never by a stored state.
 */
export const contentRequests = pgTable(
  'content_requests',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    category: enumText('category').notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    reason: text('reason').notNull(),
    structureId: uuid('structure_id').references(() => scriptStructures.id),
    /**
     * The version of the structure asked, frozen when the request is made (SC-02, ADR 0056 § 1): a change of the
     * structure afterwards writes the next version and never reaches her drop. `null` for a request of another category,
     * and for a script asked by hand before SC-02.
     */
    structureVersionId: uuid('structure_version_id').references(() => scriptStructureVersions.id),
    origin: enumText('origin').notNull(),
    state: enumText('state').notNull().default('open'),
    refusalReason: text('refusal_reason'),
    decidedAt: timestampTz('decided_at'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('content_requests', t.category, DROP_CATEGORIES),
    enumCheck('content_requests', t.origin, CONTENT_REQUEST_ORIGINS),
    enumCheck('content_requests', t.state, CONTENT_REQUEST_STATES),
    check('content_requests_reason_check', sql`char_length(${t.reason}) between 1 and 160`),
    check(
      'content_requests_structure_check',
      sql`(${t.category} = 'script') = (${t.structureId} is not null)`,
    ),
    check(
      'content_requests_refusal_check',
      sql`(${t.state} = 'open') = (${t.decidedAt} is null)
        and (${t.refusalReason} is null or (${t.state} = 'refused' and char_length(${t.refusalReason}) between 1 and 200))`,
    ),
    check('content_requests_author_check', sql`(${t.origin} = 'agency') = (${t.createdBy} is not null)`),
    check(
      'content_requests_structure_version_check',
      sql`${t.structureVersionId} is null or ${t.structureId} is not null`,
    ),
    // The cadence asks one script per due day (SC-02): its job replayed finds the request it made, never a second.
    uniqueIndex('content_requests_cadence_unique')
      .on(t.creatorId, t.dueOn)
      .where(sql`${t.origin} = 'cadence'`),
    unique('content_requests_creator_unique').on(t.id, t.creatorId),
    index('content_requests_creator_due_idx').on(t.creatorId, t.dueOn),
    pgPolicy('creator_read', { for: 'select', using: hers(t.creatorId) }),
    pgPolicy('creator_refuse', {
      for: 'update',
      using: sql`${hers(t.creatorId)} and ${t.state} = 'open'`,
      withCheck: sql`${hers(t.creatorId)} and ${t.state} = 'refused'`,
    }),
    pgPolicy('team_read', { for: 'select', using: ofHerTeam(t.creatorId) }),
    pgPolicy('team_insert', {
      for: 'insert',
      // A script asked of her is one of the library's, kept for no one else and not archived (Bilan, #506), and the
      // version asked a frozen one of that structure (SC-02 lot b).
      withCheck: sql`${ofHerTeam(t.creatorId)} and ${t.origin} = 'agency' and ${t.createdBy} = ${currentUser}
        and (${t.structureId} is null or exists (
          select 1 from script_structures s
           where s.id = ${t.structureId} and s.archived_at is null
             and (s.reserved_creator_id is null or s.reserved_creator_id = ${t.creatorId})
        ))
        and (${t.structureVersionId} is null or exists (
          select 1 from script_structure_versions v
           where v.id = ${t.structureVersionId} and v.structure_id = ${t.structureId} and v.frozen_at is not null
        ))`,
    }),
    // The agency cancels an open request; her refusal stays hers.
    pgPolicy('team_update', {
      for: 'update',
      using: sql`${ofHerTeam(t.creatorId)} and ${t.state} = 'open'`,
      withCheck: sql`${ofHerTeam(t.creatorId)} and ${t.state} in ('open', 'cancelled')`,
    }),
  ],
);

/**
 * A drop (ADR 0044 § 1, ADR 0055 § 1): her category (corrected by the agency, her choice kept in `corrected_from`),
 * her sentence, the request it answers. A script is dropped only from a request (`content_drops_script_check`); a
 * request is answered by one drop at a time (`content_drops_request_live_unique`).
 */
export const contentDrops = pgTable(
  'content_drops',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    category: enumText('category').notNull(),
    correctedFrom: enumText('corrected_from'),
    correctedBy: text('corrected_by').references(() => user.id),
    correctedAt: timestampTz('corrected_at'),
    sentence: text('sentence'),
    state: enumText('state').notNull().default('uploading'),
    blockedReason: text('blocked_reason'),
    requestId: uuid('request_id'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    withdrawnBy: text('withdrawn_by').references(() => user.id),
    withdrawnAt: timestampTz('withdrawn_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('content_drops', t.category, DROP_CATEGORIES),
    enumCheck('content_drops', t.correctedFrom, DROP_CATEGORIES),
    enumCheck('content_drops', t.state, DROP_STATES),
    check(
      'content_drops_sentence_check',
      sql`${t.sentence} is null or char_length(${t.sentence}) between 1 and 200`,
    ),
    check(
      'content_drops_blocked_check',
      sql`(${t.state} = 'blocked') = (${t.blockedReason} is not null)
        and coalesce(char_length(${t.blockedReason}), 1) between 1 and 200`,
    ),
    check(
      'content_drops_correction_check',
      sql`(${t.correctedFrom} is null) = (${t.correctedAt} is null) and (${t.correctedFrom} is null) = (${t.correctedBy} is null)
        and ${t.correctedFrom} is distinct from ${t.category}`,
    ),
    check(
      'content_drops_withdrawn_check',
      sql`(${t.state} = 'withdrawn') = (${t.withdrawnAt} is not null)
        and (${t.withdrawnAt} is null) = (${t.withdrawnBy} is null)`,
    ),
    check('content_drops_script_check', sql`${t.category} <> 'script' or ${t.requestId} is not null`),
    unique('content_drops_creator_unique').on(t.id, t.creatorId),
    foreignKey({
      name: 'content_drops_request_fk',
      columns: [t.requestId, t.creatorId],
      foreignColumns: [contentRequests.id, contentRequests.creatorId],
    }),
    uniqueIndex('content_drops_request_live_unique')
      .on(t.requestId)
      .where(sql`${t.requestId} is not null and ${t.state} <> 'withdrawn'`),
    index('content_drops_creator_created_idx').on(t.creatorId, t.createdAt),
    pgPolicy('creator_read', { for: 'select', using: hers(t.creatorId) }),
    // Her drop, by her, sending; from a request only if it is hers, open, of this category.
    // A script may begin empty, filled slot by slot (SC-02 lot b): only hers, from her request.
    pgPolicy('creator_insert', {
      for: 'insert',
      withCheck: sql`${hers(t.creatorId)} and ${t.createdBy} = ${currentUser}
        and (${t.state} = 'uploading' or (${t.state} = 'filling' and ${t.category} = 'script'))
        and ${t.correctedFrom} is null and (${t.requestId} is null or exists (
          select 1 from content_requests r
           where r.id = ${t.requestId} and r.creator_id = ${t.creatorId} and r.state = 'open' and r.category = ${t.category}
        ))`,
    }),
    pgPolicy('creator_withdraw', {
      for: 'update',
      using: sql`${hers(t.creatorId)} and ${t.state} in ('filling', 'uploading', 'received', 'ready', 'blocked')`,
      withCheck: sql`${hers(t.creatorId)} and ${t.state} = 'withdrawn' and ${t.withdrawnBy} = ${currentUser}`,
    }),
    pgPolicy('team_read', { for: 'select', using: ofHerTeam(t.creatorId) }),
    pgPolicy('team_insert', {
      for: 'insert',
      withCheck: sql`${ofHerTeam(t.creatorId)} and ${t.createdBy} = ${currentUser} and ${t.state} = 'uploading'
        and ${t.correctedFrom} is null and (${t.requestId} is null or exists (
          select 1 from content_requests r
           where r.id = ${t.requestId} and r.creator_id = ${t.creatorId} and r.state = 'open' and r.category = ${t.category}
        ))`,
    }),
    // The agency corrects a category or withdraws a drop not yet out; the job moves the rest (`withAdmin`).
    pgPolicy('team_update', {
      for: 'update',
      using: sql`${ofHerTeam(t.creatorId)} and ${t.state} not in ('published', 'withdrawn')`,
      withCheck: ofHerTeam(t.creatorId),
    }),
  ],
);

/**
 * A file of a drop, as her phone declared it, then as the server found it: kept (in the library, `media_asset_id`),
 * refused with its sentence, or a duplicate of a medium she already has. Her original's name is never stored.
 */
export const contentDropFiles = pgTable(
  'content_drop_files',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    dropId: uuid('drop_id').notNull(),
    position: integer('position').notNull(),
    kind: enumText('kind').notNull(),
    mime: enumText('mime').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    state: enumText('state').notNull().default('awaiting'),
    refusal: text('refusal'),
    mediaAssetId: uuid('media_asset_id').references(() => mediaAssets.id),
    /** The slot of her script it fills (`ScriptSlotKey`, SC-02 lot b); `null` outside a script. */
    slotKey: text('slot_key'),
    /** A video or vocal slot's lengths, copied from the slot when the file is declared: checked once cleaned. */
    minSeconds: smallint('min_seconds'),
    maxSeconds: smallint('max_seconds'),
    /**
     * When another file took its slot, before she sent her script: it leaves every view, keeps its row, and its
     * medium goes as a withdrawn drop's does (CR-06 c).
     */
    replacedAt: timestampTz('replaced_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('content_drop_files', t.kind, DROP_MEDIA_KINDS),
    enumCheck('content_drop_files', t.mime, DROP_MIME_TYPES),
    enumCheck('content_drop_files', t.state, DROP_FILE_STATES),
    // A script holds up to 24 segments of 12 slots in 3 series: 864 places.
    check('content_drop_files_position_check', sql`${t.position} between 0 and 999`),
    check(
      'content_drop_files_slot_check',
      sql`(${t.slotKey} is null or char_length(${t.slotKey}) between 4 and 40)
        and (${t.minSeconds} is null) = (${t.maxSeconds} is null)
        and (${t.minSeconds} is null or (${t.slotKey} is not null and ${t.minSeconds} between 1 and ${t.maxSeconds}))
        and (${t.replacedAt} is null or ${t.slotKey} is not null)`,
    ),
    // The heaviest file of each kind (`DROP_MAX_BYTES`, ADR 0070 § 1): 10 Gio for a video, 30 Mo for a photo or a vocal.
    check(
      'content_drop_files_bytes_check',
      sql`${t.bytes} > 0 and ${t.bytes} <= case when ${t.kind} = 'video' then 10737418240 else 31457280 end`,
    ),
    check(
      'content_drop_files_refusal_check',
      sql`(${t.state} = 'refused') = (${t.refusal} is not null) and coalesce(char_length(${t.refusal}), 1) between 1 and 200`,
    ),
    check(
      'content_drop_files_media_check',
      sql`(${t.state} in ('kept', 'duplicate')) = (${t.mediaAssetId} is not null)`,
    ),
    // One live file per place and per slot; a replaced one keeps its row beside its successor.
    uniqueIndex('content_drop_files_position_unique')
      .on(t.dropId, t.position)
      .where(sql`${t.replacedAt} is null`),
    uniqueIndex('content_drop_files_slot_unique')
      .on(t.dropId, t.slotKey)
      .where(sql`${t.slotKey} is not null and ${t.replacedAt} is null`),
    foreignKey({
      name: 'content_drop_files_drop_fk',
      columns: [t.dropId, t.creatorId],
      foreignColumns: [contentDrops.id, contentDrops.creatorId],
    }),
    index('content_drop_files_creator_idx').on(t.creatorId),
    // The drops a medium came in by, read each hour by `content_drops.erase_originals` (CR-06 c).
    index('content_drop_files_media_idx')
      .on(t.mediaAssetId)
      .where(sql`${t.mediaAssetId} is not null`),
    pgPolicy('creator_read', { for: 'select', using: hers(t.creatorId) }),
    // A file joins only a drop of hers still sending or being filled, and waits for its bytes.
    pgPolicy('creator_insert', {
      for: 'insert',
      withCheck: sql`${hers(t.creatorId)} and ${t.state} = 'awaiting' and ${t.replacedAt} is null and exists (
        select 1 from content_drops d where d.id = ${t.dropId} and d.creator_id = ${t.creatorId}
          and d.state in ('uploading', 'filling')
      )`,
    }),
    // She replaces a slot's file while she fills her script: only its `replaced_at` (the column grant, migration
    // 0123), once.
    pgPolicy('creator_replace', {
      for: 'update',
      using: sql`${hers(t.creatorId)} and ${t.slotKey} is not null and ${t.replacedAt} is null and exists (
        select 1 from content_drops d where d.id = ${t.dropId} and d.creator_id = ${t.creatorId} and d.state = 'filling'
      )`,
      withCheck: sql`${hers(t.creatorId)} and ${t.replacedAt} is not null`,
    }),
    pgPolicy('team_read', { for: 'select', using: ofHerTeam(t.creatorId) }),
    pgPolicy('team_insert', {
      for: 'insert',
      withCheck: sql`${ofHerTeam(t.creatorId)} and ${t.state} = 'awaiting' and exists (
        select 1 from content_drops d where d.id = ${t.dropId} and d.creator_id = ${t.creatorId} and d.state = 'uploading'
      )`,
    }),
  ],
);
