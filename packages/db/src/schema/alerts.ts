import {
  ALERT_KEYWORD_MAX,
  CUSTOM_ALERT_KEYWORDS_MAX,
  CUSTOM_ALERT_NAME_MAX,
  CUSTOM_ALERT_PHRASE_MAX,
  SYSTEM_ALERT_CODES,
} from '@nirvana/contracts';
import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, enumCheck, enumText, id, tenantPolicy, timestampTz, updatedAt } from './columns';
import { conversationEvents } from './conversations';
import { creators } from './tenancy';

/**
 * Her own alerts (P4-01): one row per creator, so that RLS keeps each one to her; the rows written together share a
 * `group_id` and the screen shows them as one alert. A removed alert is archived, never deleted: the history still
 * names the alerts that went off.
 */
export const customAlerts = pgTable(
  'custom_alerts',
  {
    id: id(),
    groupId: uuid('group_id').notNull(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    name: text('name').notNull(),
    phrase: text('phrase'),
    keywords: text('keywords')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    pausesAgent: boolean('pauses_agent').notNull(),
    notify: boolean('notify').notNull(),
    enabled: boolean('enabled').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestampTz('archived_at'),
  },
  (t) => [
    unique('custom_alerts_group_creator_unique').on(t.groupId, t.creatorId),
    index('custom_alerts_creator_idx')
      .on(t.creatorId)
      .where(sql`${t.archivedAt} is null`),
    check(
      'custom_alerts_name_check',
      sql`char_length(${t.name}) between 1 and ${sql.raw(String(CUSTOM_ALERT_NAME_MAX))}`,
    ),
    check(
      'custom_alerts_phrase_check',
      sql`${t.phrase} is null or char_length(${t.phrase}) between 1 and ${sql.raw(String(CUSTOM_ALERT_PHRASE_MAX))}`,
    ),
    check(
      'custom_alerts_keywords_check',
      sql`cardinality(${t.keywords}) <= ${sql.raw(String(CUSTOM_ALERT_KEYWORDS_MAX))} and array_position(${t.keywords}, null) is null and char_length(array_to_string(${t.keywords}, '')) <= ${sql.raw(String(CUSTOM_ALERT_KEYWORDS_MAX * ALERT_KEYWORD_MAX))}`,
    ),
    check('custom_alerts_matcher_check', sql`${t.phrase} is not null or cardinality(${t.keywords}) > 0`),
    tenantPolicy(t.creatorId),
  ],
);

/**
 * « Marquer comme vu » in the history of alerts (P4-01): the journal is append-only, so the seen mark lives here, one
 * per event, shared by the agency. An event is an `alert_triggered`, or a `handoff_requested` that carries a trigger.
 * Owned by `conversations`, which owns the journal and serves the history. Keyed by creator too: a mark written under another creator (a bug) is never read by hers, nor blocks hers.
 */
export const alertSeen = pgTable(
  'alert_seen',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => conversationEvents.id),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    seenBy: text('seen_by')
      .notNull()
      .references(() => user.id),
    seenAt: timestampTz('seen_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'alert_seen_pkey', columns: [t.creatorId, t.eventId] }),
    tenantPolicy(t.creatorId),
  ],
);

/**
 * The system's alerts switched on or off for one creator (P4-01): no row is on. `keyword` never has a row that is
 * off: her words are her persona's (the module refuses it).
 */
export const systemAlertSettings = pgTable(
  'system_alert_settings',
  {
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    code: enumText('code').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'system_alert_settings_pkey', columns: [t.creatorId, t.code] }),
    enumCheck('system_alert_settings', t.code, SYSTEM_ALERT_CODES),
    check('system_alert_settings_keyword_check', sql`${t.code} <> 'keyword' or ${t.enabled}`),
    tenantPolicy(t.creatorId),
  ],
);
