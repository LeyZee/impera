import { CurrencySchema, DESCRIPTION_REVIEW_REASONS } from '@impera/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, creatorReadsOnly, enumCheck, enumText, id, tenantPolicy, timestampTz } from './columns';
import { conversations, messages } from './conversations';
import { fans } from './fans';
import { creators } from './tenancy';

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
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('media_assets', t.kind, MEDIA_KINDS),
    enumCheck('media_assets', t.origin, MEDIA_ORIGINS),
    check(
      'media_assets_thumbnail_check',
      sql`${t.thumbnailKey} is null or (${t.thumbnailedAt} is not null and ${t.kind} <> 'audio')`,
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
