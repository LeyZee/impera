import { CurrencySchema } from '@nirvana/contracts';
import { sql } from 'drizzle-orm';
import { bigint, char, check, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { createdAt, enumCheck, enumText, id, tenantPolicy, timestampTz } from './columns';
import { conversations, messages } from './conversations';
import { fans } from './fans';
import { creators } from './tenancy';

/** Module `media`: files (the bytes live in object storage), their descriptions, and what was sold to whom. */

export const MEDIA_KINDS = ['image', 'video', 'audio'] as const;
export const MEDIA_ORIGINS = ['creator', 'fan'] as const;

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
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('media_assets', t.kind, MEDIA_KINDS),
    enumCheck('media_assets', t.origin, MEDIA_ORIGINS),
    unique('media_assets_creator_sha256_unique').on(t.creatorId, t.sha256),
    tenantPolicy(t.creatorId),
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
    createdAt: createdAt(),
  },
  (t) => [index('media_descriptions_asset_idx').on(t.mediaAssetId), tenantPolicy(t.creatorId)],
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
  ],
);
