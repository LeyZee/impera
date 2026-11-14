import {
  CurrencySchema,
  DESCRIPTION_REVIEW_REASONS,
  PlatformSchema,
  PlatformScriptMomentSchema,
} from '@impera/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, creatorReadsOnly, enumCheck, enumText, id, tenantPolicy, timestampTz } from './columns';
import { conversations, messages } from './conversations';
import { fans } from './fans';
import { creators, platformAccounts } from './tenancy';

/** Module `media`: files (the bytes live in object storage), their descriptions, and what was sold to whom. */

export const MEDIA_KINDS = ['image', 'video', 'audio'] as const;
export const MEDIA_ORIGINS = ['creator', 'fan'] as const;
export const DESCRIPTION_AUTHORS = ['sense', 'human'] as const;

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
    ...creatorReadsOnly(),
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
    tenantPolicy(t.creatorId),
    ...creatorReadsOnly(),
  ],
);
