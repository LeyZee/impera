import {
  CurrencySchema,
  DESCRIPTION_REVIEW_REASONS,
  PlatformSchema,
  PlatformScriptMomentSchema,
  VAULT_BLURHASH_MAX,
  VAULT_DESCRIPTION_MAX,
  VAULT_FOLDER_NAME_MAX,
} from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
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
import {
  closedToCreator,
  createdAt,
  creatorReadsOnly,
  enumCheck,
  enumText,
  id,
  notCreatorAccount,
  tenantPolicy,
  timestampTz,
} from './columns';
import { conversations, messages } from './conversations';
import { fans } from './fans';
import { creators, platformAccounts } from './tenancy';

/** Module `media`: files (the bytes live in object storage), their descriptions, and what was sold to whom. */

export const MEDIA_KINDS = ['image', 'video', 'audio'] as const;
/**
 * `creator`: dropped by her, an original that lived in our storage; `fan`: sent by a fan; `vault`: read from the
 * platform's vault the time of its description, never stored (ADR 0113 § 1): born erased, its `storage_key` empty.
 */
export const MEDIA_ORIGINS = ['creator', 'fan', 'vault'] as const;
/** `platform`: the platform's own text of a vault media, a starting point never validated (ADR 0099 § 4, ADR 0113 § 5). */
export const DESCRIPTION_AUTHORS = ['sense', 'human', 'platform'] as const;

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    kind: enumText('kind').notNull(),
    origin: enumText('origin').notNull(),
    fanId: uuid('fan_id').references(() => fans.id),
    /** Empty for a vault media only, which never touched the storage (ADR 0113 § 1, `media_assets_storage_key_check`). */
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    durationMs: integer('duration_ms'),
    sha256: text('sha256').notNull(),
    rights: jsonb('rights').notNull().default({}),
    /** Fan media expire (security.md: 30 days by default); creator media follow their rights. */
    expiresAt: timestampTz('expires_at'),
    /**
     * When its original left the storage (CR-06 c, ADR 0044 § 2): the row stays, with its fingerprint, length, type and
     * description; `storage_key` then names nothing.
     */
    erasedAt: timestampTz('erased_at'),
    /**
     * Its reduced picture for the agency's screen (ADR 0030 § 4, SC-04 lot c4), a JPEG kept after the original is
     * erased; `null` before it is made, or when it could not be made (`thumbnailed_at` set, a file ffmpeg cannot read).
     */
    thumbnailKey: text('thumbnail_key'),
    /** When its reduced picture was tried, made or not: a medium is tried once. */
    thumbnailedAt: timestampTz('thumbnailed_at'),
    /**
     * The vision AI's tries that failed to describe it (recette créatrice, anomaly 2): at the job's attempts, it is no
     * longer asked, by the job nor by the hourly backlog, until the agency asks again (« Réessayer ») or writes it.
     */
    descriptionFailures: smallint('description_failures').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('media_assets', t.kind, MEDIA_KINDS),
    enumCheck('media_assets', t.origin, MEDIA_ORIGINS),
    check(
      'media_assets_thumbnail_check',
      sql`${t.thumbnailKey} is null or (${t.thumbnailedAt} is not null and ${t.kind} <> 'audio')`,
    ),
    check('media_assets_description_failures_check', sql`${t.descriptionFailures} >= 0`),
    // ADR 0113 § 1: the key is empty if and only if the media came from the vault, and a vault media is born erased.
    check(
      'media_assets_storage_key_check',
      sql`(${t.storageKey} = '') = (${t.origin} = 'vault') and (${t.origin} <> 'vault' or ${t.erasedAt} is not null)`,
    ),
    unique('media_assets_creator_sha256_unique').on(t.creatorId, t.sha256),
    // The originals still held with a date (CR-06 c): `content_drops.erase_originals` reads them each hour.
    index('media_assets_due_idx')
      .on(t.expiresAt)
      .where(sql`${t.erasedAt} is null and ${t.expiresAt} is not null`),
    tenantPolicy(t.creatorId),
    ...creatorReadsOnly(),
  ],
);

/**
 * The platform's vault as the CRM mirrors it (ADR 0030 § 1, ADR 0099 § 2 to 4, fiche vault-sync): one row per media of
 * a creator's account, written by `connector.vault_sync` inside her tenant, never deleted (`removed_at` when the
 * platform no longer lists it). No file: `media_asset_id` stays empty until its bytes are fetched (fiche
 * vault-fetch-media). Its folder and order are the platform's, read again at each sync: sorted by `platform_created_at`
 * as the platform lists it, then `folder_position` (the platform's rank between uploads of the same second), then the
 * platform's id. `platform_description` is the platform's own text, a starting point never validated: it becomes a
 * `media_descriptions` row of its own once the media has an asset (ADR 0099 § 4).
 */
export const mediaPlatformRefs = pgTable(
  'media_platform_refs',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platform: enumText('platform').notNull(),
    platformAccountId: uuid('platform_account_id').notNull(),
    platformMediaId: text('platform_media_id').notNull(),
    mediaAssetId: uuid('media_asset_id').references(() => mediaAssets.id),
    kind: enumText('kind').notNull(),
    /** `null` at the vault's root. */
    folderRef: text('folder_ref'),
    folderName: text('folder_name'),
    folderMoment: enumText('folder_moment'),
    /**
     * Not the connector's `VaultMedia.folderPosition` (its rank in the whole folder, which moves at each upload): the
     * rank among the media of the same folder uploaded at the same millisecond, from 0, in the platform's order. The
     * folder's order is `platform_created_at` descending, then this rank.
     */
    folderPosition: integer('folder_position').notNull(),
    platformCreatedAt: timestampTz('platform_created_at').notNull(),
    durationSeconds: integer('duration_seconds'),
    platformDescription: text('platform_description'),
    /** The platform's suggested range, in its minor unit: shown to the agency, never applied (ADR 0099 § 4). */
    suggestedMinMinor: integer('suggested_min_minor'),
    suggestedMaxMinor: integer('suggested_max_minor'),
    /**
     * The tries of `media.describe_vault` that could not describe it while it has no file (ADR 0113 § 3, § 5): every
     * vision model failing counts one; a file that does not read (a stream of an unknown form, a picture ffmpeg cannot
     * open) counts them all at once. At `DESCRIPTION_TRIES` it is no longer taken: it waits for the agency's text
     * (« À décrire par l'agence »), never an invented description.
     */
    descriptionFailures: smallint('description_failures').notNull().default(0),
    /** The platform's blurred preview (a blurhash, `BlurhashSchema`): a few colours, never the image (ADR 0030 § 4). */
    previewBlurhash: text('preview_blurhash'),
    /**
     * When a sync first read it as sent for free by the platform (Reveal's `sentForFree`: offered in a message or a
     * Mass DM), `null` until then. Kept once set, whatever a later read says: a media once offered is never sold again
     * (ADR 0145 § 2, the media's mark).
     */
    sentForFreeAt: timestampTz('sent_for_free_at'),
    lastSyncedAt: timestampTz('last_synced_at').notNull(),
    removedAt: timestampTz('removed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('media_platform_refs', t.platform, PlatformSchema.options),
    enumCheck('media_platform_refs', t.kind, MEDIA_KINDS),
    check(
      'media_platform_refs_folder_check',
      sql`(${t.folderRef} is null) = (${t.folderName} is null) and (${t.folderRef} is not null or ${t.folderMoment} is null)`,
    ),
    // ☀️ or 🌙 read in the folder's name (ADR 0099 § 2); `null` when it says neither or both.
    enumCheck('media_platform_refs', t.folderMoment, PlatformScriptMomentSchema.options),
    check('media_platform_refs_folder_position_check', sql`${t.folderPosition} >= 0`),
    check(
      'media_platform_refs_suggested_check',
      sql`(${t.suggestedMinMinor} is null) = (${t.suggestedMaxMinor} is null) and coalesce(${t.suggestedMinMinor}, 0) >= 0 and coalesce(${t.suggestedMaxMinor}, 0) >= 0`,
    ),
    // The contract's bounds (VaultMediaSchema): the platform's text is cut by the connector, never refused here.
    check(
      'media_platform_refs_text_check',
      sql`char_length(${t.folderName}) <= ${sql.raw(String(VAULT_FOLDER_NAME_MAX))} and char_length(${t.platformDescription}) <= ${sql.raw(String(VAULT_DESCRIPTION_MAX))}`,
    ),
    check('media_platform_refs_description_failures_check', sql`${t.descriptionFailures} >= 0`),
    check(
      'media_platform_refs_blurhash_check',
      sql`char_length(${t.previewBlurhash}) <= ${sql.raw(String(VAULT_BLURHASH_MAX))}`,
    ),
    check(
      'media_platform_refs_duration_check',
      sql`${t.durationSeconds} is null or ${t.durationSeconds} >= 0`,
    ),
    unique('media_platform_refs_account_media_unique').on(t.platformAccountId, t.platformMediaId),
    // An account and its creator always go together, as the planning's keys hold them (EQ-02).
    foreignKey({
      name: 'media_platform_refs_account_fk',
      columns: [t.platformAccountId, t.creatorId],
      foreignColumns: [platformAccounts.id, platformAccounts.creatorId],
    }),
    index('media_platform_refs_order_idx').on(
      t.creatorId,
      t.folderRef,
      t.platformCreatedAt,
      t.folderPosition,
      t.platformMediaId,
    ),
    tenantPolicy(t.creatorId),
    ...creatorReadsOnly(),
  ],
);

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const readsTeam: SQL = sql`${currentScope} in ('owner', 'agency')`;
const isOwner: SQL = sql`${currentScope} = 'owner'`;

export const VAULT_CHOICE_SCOPES = ['folder', 'media'] as const;

/**
 * What enters the CRM of a vault (ADR 0145 § 5, amendment of 17/11): a folder ticked whole (`folder`, `folder_ref` null
 * for the root), or one media's own tick (`media`), which wins over its folder's. No row: not imported. Set by the
 * owner alone under her RLS, read by the owner and the active managers, closed to her account; read by the jobs as
 * the service role.
 */
export const vaultImportChoices = pgTable(
  'vault_import_choices',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platformAccountId: uuid('platform_account_id').notNull(),
    scope: enumText('scope').notNull(),
    folderRef: text('folder_ref'),
    platformMediaId: text('platform_media_id'),
    imported: boolean('imported').notNull(),
    chosenBy: text('chosen_by')
      .notNull()
      .references(() => user.id),
    chosenAt: timestampTz('chosen_at').notNull().defaultNow(),
  },
  (t) => [
    enumCheck('vault_import_choices', t.scope, VAULT_CHOICE_SCOPES),
    check(
      'vault_import_choices_target_check',
      sql`(${t.scope} = 'folder' and ${t.platformMediaId} is null) or (${t.scope} = 'media' and ${t.platformMediaId} is not null and ${t.folderRef} is null)`,
    ),
    check(
      'vault_import_choices_text_check',
      sql`char_length(${t.folderRef}) <= 200 and char_length(${t.platformMediaId}) <= 200`,
    ),
    foreignKey({
      name: 'vault_import_choices_account_fk',
      columns: [t.platformAccountId, t.creatorId],
      foreignColumns: [platformAccounts.id, platformAccounts.creatorId],
    }),
    // One tick per folder, the root's included (`''` stands for it here only), and one per media.
    uniqueIndex('vault_import_choices_folder_unique')
      .on(t.platformAccountId, sql`coalesce(${t.folderRef}, '')`)
      .where(sql`${t.scope} = 'folder'`),
    uniqueIndex('vault_import_choices_media_unique')
      .on(t.platformAccountId, t.platformMediaId)
      .where(sql`${t.scope} = 'media'`),
    index('vault_import_choices_creator_idx').on(t.creatorId, t.platformAccountId),
    pgPolicy('team_read', { for: 'select', using: sql`${t.creatorId} = ${currentCreator} and ${readsTeam}` }),
    pgPolicy('owner_write', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${isOwner} and ${t.chosenBy} = ${currentUser}`,
    }),
    pgPolicy('owner_change', {
      for: 'update',
      using: sql`${t.creatorId} = ${currentCreator} and ${isOwner}`,
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${isOwner} and ${t.chosenBy} = ${currentUser}`,
    }),
    pgPolicy('owner_clear', { for: 'delete', using: sql`${t.creatorId} = ${currentCreator} and ${isOwner}` }),
    closedToCreator(),
  ],
);

/**
 * Whether a vault media is in the CRM (ADR 0145 § 5): its own tick when it has one, else its folder's (the root's for
 * `folder_ref` null), else not. Given the columns of a `media_platform_refs` row, in the caller's query and RLS.
 */
export function vaultImported(ref: {
  readonly account: SQL;
  readonly media: SQL;
  readonly folder: SQL;
}): SQL<boolean> {
  return sql<boolean>`coalesce(
    (select c.imported from vault_import_choices c
      where c.platform_account_id = ${ref.account} and c.scope = 'media' and c.platform_media_id = ${ref.media}),
    (select c.imported from vault_import_choices c
      where c.platform_account_id = ${ref.account} and c.scope = 'folder'
        and coalesce(c.folder_ref, '') = coalesce(${ref.folder}, '')),
    false)`;
}

const appUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;

/** A medium kept from one of her drops not withdrawn (ADR 0163 § 4): the only rows of hers she may review. */
const herDroppedMedium = (t: { readonly creatorId: PgColumn; readonly mediaAssetId: PgColumn }): SQL =>
  sql`exists (select 1 from content_drop_files f join content_drops d on d.id = f.drop_id
       where f.media_asset_id = ${t.mediaAssetId} and d.creator_id = ${t.creatorId}
         and d.state <> 'withdrawn' and f.state in ('kept', 'duplicate'))`;

/**
 * A description that waits for the agency (Sécurité on #995): a reason the code held it for a human (ADR 0083 § 3 to
 * 5) or a flag of the vision. Hers to read, never hers to lift.
 */
const awaitsAgency = (t: { readonly reviewReasons: PgColumn; readonly content: PgColumn }): SQL =>
  sql`(cardinality(${t.reviewReasons}) > 0 or jsonb_array_length(coalesce(${t.content} -> 'flags', '[]'::jsonb)) > 0)`;

/** Some row of this medium, not validated yet, waits for the agency: her correction cannot lift it either. */
const mediumAwaitsAgency = (t: { readonly mediaAssetId: PgColumn }): SQL =>
  sql`exists (select 1 from media_descriptions w
       where w.media_asset_id = ${t.mediaAssetId} and w.validated_at is null
         and (cardinality(w.review_reasons) > 0
              or jsonb_array_length(coalesce(w.content -> 'flags', '[]'::jsonb)) > 0))`;

/**
 * Whether a vault media was offered (ADR 0145 § 2, « un média offert n'est jamais revendu »): the platform read it as
 * sent for free once (`sent_for_free_at`), or its file is kept by a live drop of hers that leaves for free (any drop
 * but a script: feed, stories, Instagram, Telegram, Mass DM). Given the columns of a `media_platform_refs` row, in the
 * caller's query and RLS. A media whose file is not read yet (`media_asset_id` null) answers by the platform's mark.
 */
export function vaultOffered(ref: { readonly sentForFreeAt: SQL; readonly mediaAsset: SQL }): SQL<boolean> {
  return sql<boolean>`(${ref.sentForFreeAt} is not null or exists (
    select 1 from content_drop_files f join content_drops d on d.id = f.drop_id
     where f.media_asset_id = ${ref.mediaAsset} and f.state in ('kept', 'duplicate') and f.replaced_at is null
       and d.category <> 'script' and d.state <> 'withdrawn'))`;
}

/**
 * Whether a media of hers is sold by a script (ADR 0145 § 2, « un média de script n'est jamais gratuit »): its file is
 * kept by a live script drop of hers, or it is a sold media of a paid step of one of her active native scripts. Given
 * a `media_assets` id, in the caller's query and RLS.
 */
export function mediaInScript(mediaAsset: SQL): SQL<boolean> {
  return sql<boolean>`(exists (
    select 1 from content_drop_files f join content_drops d on d.id = f.drop_id
     where f.media_asset_id = ${mediaAsset} and f.state in ('kept', 'duplicate') and f.replaced_at is null
       and d.category = 'script' and d.state <> 'withdrawn')
    or exists (
    select 1 from media_platform_refs l
      join platform_scripts ps on ps.platform_account_id = l.platform_account_id and ps.active
      join platform_script_step_media sm on sm.platform_script_id = ps.id and sm.role = 'sold'
        and sm.platform_media_ref = l.platform_media_id
      join platform_script_steps st on st.platform_script_id = sm.platform_script_id and st.position = sm.position
     where l.media_asset_id = ${mediaAsset} and st.price_minor > 0))`;
}

/**
 * A media of the vault the owner asked to describe (ADR 0145 § 5, amendment of 17/11), after the count and the cost
 * were shown: `media.describe_vault` takes only these. Once per media; `asked_key` is the gesture's, so a gesture
 * replayed answers what it asked. Written by the owner alone, never changed nor removed.
 */
export const vaultDescribeRequests = pgTable(
  'vault_describe_requests',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platformAccountId: uuid('platform_account_id').notNull(),
    platformMediaId: text('platform_media_id').notNull(),
    askedKey: uuid('asked_key').notNull(),
    askedBy: text('asked_by')
      .notNull()
      .references(() => user.id),
    askedAt: timestampTz('asked_at').notNull().defaultNow(),
  },
  (t) => [
    unique('vault_describe_requests_media_unique').on(t.platformAccountId, t.platformMediaId),
    foreignKey({
      name: 'vault_describe_requests_ref_fk',
      columns: [t.platformAccountId, t.platformMediaId],
      foreignColumns: [mediaPlatformRefs.platformAccountId, mediaPlatformRefs.platformMediaId],
    }),
    foreignKey({
      name: 'vault_describe_requests_account_fk',
      columns: [t.platformAccountId, t.creatorId],
      foreignColumns: [platformAccounts.id, platformAccounts.creatorId],
    }),
    index('vault_describe_requests_key_idx').on(t.creatorId, t.askedKey),
    pgPolicy('team_read', { for: 'select', using: sql`${t.creatorId} = ${currentCreator} and ${readsTeam}` }),
    pgPolicy('owner_ask', {
      for: 'insert',
      withCheck: sql`${t.creatorId} = ${currentCreator} and ${isOwner} and ${t.askedBy} = ${currentUser}`,
    }),
    closedToCreator(),
  ],
);

export const mediaDescriptions = pgTable(
  'media_descriptions',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    mediaAssetId: uuid('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    vocabularyVersion: text('vocabulary_version').notNull(),
    content: jsonb('content').notNull(),
    model: text('model').notNull(),
    promptHash: text('prompt_hash').notNull(),
    /**
     * Who wrote it (ADR 0030 § 3): `sense`, the vision AI; `human`, a correction by the agency or her, as a new row
     * (the table is append-only).
     */
    author: enumText('author').notNull().default('sense'),
    /** Her own word on the media (P6-01), free text. */
    creatorNote: text('creator_note'),
    /**
     * Why it waits for a human before any use (ADR 0083 § 3 to 5, `DESCRIPTION_REVIEW_REASONS`): read by the code
     * on the model's answer; empty when nothing holds it back. It is still validated before use (§ 7).
     */
    reviewReasons: text('review_reasons')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * Who validated this very row (ADR 0030 § 3, amended 08/11/2026): the account of the owner, an active manager or
     * her, never a free text. Set once with `validated_at`, the only change a row takes (`media_descriptions_kept`).
     */
    validatedBy: text('validated_by').references(() => user.id),
    validatedAt: timestampTz('validated_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('media_descriptions_asset_idx').on(t.mediaAssetId),
    check('media_descriptions_validated_check', sql`(${t.validatedBy} is null) = (${t.validatedAt} is null)`),
    enumCheck('media_descriptions', t.author, DESCRIPTION_AUTHORS),
    check(
      'media_descriptions_review_reasons_check',
      sql`${t.reviewReasons} <@ array[${sql.raw(DESCRIPTION_REVIEW_REASONS.map((r) => `'${r}'`).join(', '))}]::text[]`,
    ),
    // The vision AI describes a dropped media once per describer (ADR 0083 § 1): a replayed job writes nothing twice.
    // Only a drop's description (it alone has `detailed`): a fan's media keeps its latest description (SUIVI-26).
    uniqueIndex('media_descriptions_drop_unique')
      .on(t.mediaAssetId, t.promptHash)
      .where(sql`${t.author} = 'sense' and ${t.content} ? 'detailed'`),
    tenantPolicy(t.creatorId),
    // She reads these rows, and since ADR 0163 § 4 she validates and corrects the description of a medium of her own
    // drops, as the agency does: a human row validated by her account at its writing, or the two stamp columns of a
    // row not validated yet (the column grant of migration 0152 and `refuse_description_change` hold the rest). The
    // restrictive policies stay restrictive: nothing permissive can open more for her. A row waiting for the agency (a
    // review reason, a flag of the vision) is never hers to validate or to correct (Sécurité on #995).
    pgPolicy('creator_no_delete', { as: 'restrictive', for: 'delete', using: notCreatorAccount }),
    pgPolicy('creator_no_insert', {
      as: 'restrictive',
      for: 'insert',
      withCheck: sql`${notCreatorAccount} or (${t.author} = 'human' and ${t.model} = 'human'
        and ${t.validatedBy} = ${appUser} and ${t.validatedAt} is not null and ${herDroppedMedium(t)}
        and not ${awaitsAgency(t)} and not ${mediumAwaitsAgency(t)})`,
    }),
    pgPolicy('creator_no_update', {
      as: 'restrictive',
      for: 'update',
      using: sql`${notCreatorAccount} or (${t.validatedAt} is null and ${herDroppedMedium(t)} and not ${awaitsAgency(t)})`,
      withCheck: sql`${notCreatorAccount} or (${t.validatedBy} = ${appUser} and ${herDroppedMedium(t)})`,
    }),
  ],
);

/** Anti-duplicate: a paid media is never sold twice to the same fan. */
export const mediaSends = pgTable(
  'media_sends',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    mediaAssetId: uuid('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    fanId: uuid('fan_id')
      .notNull()
      .references(() => fans.id),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    messageId: uuid('message_id').references(() => messages.id),
    priceMinor: integer('price_minor'),
    currency: char('currency', { length: 3 }),
    sentAt: timestampTz('sent_at').notNull(),
  },
  (t) => [
    enumCheck('media_sends', t.currency, CurrencySchema.options),
    check('media_sends_price_minor_check', sql`${t.priceMinor} is null or ${t.priceMinor} >= 0`),
    index('media_sends_fan_media_idx').on(t.fanId, t.mediaAssetId),
    // A medium given for free goes once to a fan (ADR 0163 § 7): the agent's note of a voice or a gift, replayable.
    uniqueIndex('media_sends_free_once_idx')
      .on(t.fanId, t.mediaAssetId)
      .where(sql`${t.priceMinor} is null`),
    tenantPolicy(t.creatorId),
    ...creatorReadsOnly(),
  ],
);
