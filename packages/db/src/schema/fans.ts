import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { creatorReadsOnly, id, tenantPolicy, timestampTz } from './columns';
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
  },
  (t) => [
    unique('fans_platform_fan_unique').on(t.platformAccountId, t.platformFanId),
    index('fans_creator_idx').on(t.creatorId),
    tenantPolicy(t.creatorId),
    ...creatorReadsOnly(),
  ],
);
