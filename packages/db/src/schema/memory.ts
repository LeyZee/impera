import { FactCategorySchema, StoredFactKindSchema } from '@impera/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  real,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, creatorReadsOnly, enumCheck, enumText, id, tenantPolicy, timestampTz } from './columns';
import { messages } from './conversations';
import { fans } from './fans';
import { creators } from './tenancy';

/** What she knows about each fan (module `fans`): facts and summaries, tied to the message they came from. */

/** Append-only: a new fact supersedes the old one (`superseded_by`), history is kept. */
export const fanFacts = pgTable(
  'fan_facts',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    fanId: uuid('fan_id')
      .notNull()
      .references(() => fans.id),
    category: enumText('category').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    kind: enumText('kind').notNull(),
    confidence: real('confidence').notNull(),
    sourceMessageId: uuid('source_message_id').references((): AnyPgColumn => messages.id),
    observedAt: timestampTz('observed_at').notNull(),
    expiresAt: timestampTz('expires_at'),
    supersededBy: uuid('superseded_by').references((): AnyPgColumn => fanFacts.id),
    /** The chatter who wrote a `noted` value on the fan's card (ADR 0085 § 5); null for every other kind. */
    notedBy: text('noted_by').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    enumCheck('fan_facts', t.category, FactCategorySchema.options),
    enumCheck('fan_facts', t.kind, StoredFactKindSchema.options),
    // A chatter's value names its author, and no other value does (ADR 0085 § 5, § 12).
    check('fan_facts_noted_by_check', sql`(${t.kind} = 'noted') = (${t.notedBy} is not null)`),
    check('fan_facts_confidence_check', sql`${t.confidence} between 0 and 1`),
    index('fan_facts_active_idx')
      .on(t.fanId)
      .where(sql`${t.supersededBy} is null`),
    tenantPolicy(t.creatorId),
    ...creatorReadsOnly(),
  ],
);

export const fanSummaries = pgTable(
  'fan_summaries',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    fanId: uuid('fan_id')
      .notNull()
      .references(() => fans.id),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    basedOnMessageId: uuid('based_on_message_id').references((): AnyPgColumn => messages.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('fan_summaries_fan_version_unique').on(t.fanId, t.version),
    tenantPolicy(t.creatorId),
    ...creatorReadsOnly(),
  ],
);
