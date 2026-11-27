import { FAN_LANGUAGE_SOURCES, LANGUAGES } from '@impera/contracts';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { creatorReadsOnly, enumCheck, id, tenantPolicy, timestampTz } from './columns';
import { creators, platformAccounts } from './tenancy';

export const fans = pgTable(
  'fans',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platformAccountId: uuid('platform_account_id')
      .notNull()
      .references(() => platformAccounts.id),
    platformFanId: text('platform_fan_id').notNull(),
    displayName: text('display_name').notNull(),
    /** The same person across platforms, later. */
    personId: uuid('person_id'),
    firstSeenAt: timestampTz('first_seen_at').notNull().defaultNow(),
    lastSeenAt: timestampTz('last_seen_at').notNull().defaultNow(),
    kycState: jsonb('kyc_state').notNull().default({}),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    flags: jsonb('flags').notNull().default({}),
    /** Platform-specific data (subscription…); empty for Reveal (own-platform.md). */
    platformMeta: jsonb('platform_meta').notNull().default({}),
    /**
     * His kept language (ADR 0168 § 3), a value of `LANGUAGES`: read by code on his messages (`detected`) or set by a
     * person (`set`, by `language_set_by`), whom code never overwrites. Null until one is known.
     */
    language: text('language'),
    languageSource: text('language_source'),
    languageSetBy: text('language_set_by').references(() => user.id),
    languageSetAt: timestampTz('language_set_at'),
  },
  (t) => [
    unique('fans_platform_fan_unique').on(t.platformAccountId, t.platformFanId),
    // Lets a row of another table name his creator with him (`custom_orders`): never a fan of another creator.
    unique('fans_id_creator_unique').on(t.id, t.creatorId),
    index('fans_creator_idx').on(t.creatorId),
    enumCheck('fans', t.language, LANGUAGES),
    enumCheck('fans', t.languageSource, FAN_LANGUAGE_SOURCES),
    // Whole or absent: the language, where it comes from, when; a person's name exactly when a person set it.
    check(
      'fans_language_whole_check',
      sql`(${t.language} is null and ${t.languageSource} is null and ${t.languageSetAt} is null and ${t.languageSetBy} is null) or (${t.language} is not null and ${t.languageSource} is not null and ${t.languageSetAt} is not null and (${t.languageSource} = 'set') = (${t.languageSetBy} is not null))`,
    ),
    tenantPolicy(t.creatorId),
    ...creatorReadsOnly(),
  ],
);
