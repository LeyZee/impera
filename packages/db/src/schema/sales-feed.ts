import {
  CurrencySchema,
  PlatformModelStatusSchema,
  PlatformSchema,
  SaleEventSchema,
  SaleStatusSchema,
  SaleTypeSchema,
  SalesFeedCheckVerdictSchema,
  SalesFeedErrorKindSchema,
  SalesFeedStateSchema,
} from '@impera/contracts';
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  agencyOnly,
  closedToCreator,
  createdAt,
  enumCheck,
  enumText,
  id,
  tenantPolicy,
  timestampTz,
  updatedAt,
} from './columns';
import { teamMembers } from './team';
import { creators, platformAccounts } from './tenancy';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/**
 * A link that may be written by this transaction (ADR 0076 § 4): the owner's scope, or the agency's when it does not
 * point to the writer's own member record. Outside `withMember` no scope is set and nothing passes.
 */
const notOwnLink = (memberId: AnyColumn): SQL =>
  sql`nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and (${memberId} is null or not exists (select 1 from team_members m where m.id = ${memberId} and m.user_id = nullif(current_setting('app.user_id', true), ''))))`;

/**
 * The sales feed of a platform (ADR 0050): its register of sales and refunds read with an agency key, without any
 * captured session. Owned by the connectors module: only it writes these tables.
 */

/**
 * One key per platform, an agency setting (ADR 0050 § 4, ADR 0016 § 3): sealed with CREDENTIALS_ENCRYPTION_KEYS
 * (crypto.ts, context `sales_feed:<platform>`), out of RLS and revoked from `nirvana_app` by the migration, read and
 * written through `withAdmin` only. Kept only after a verification call went through.
 */
export const salesFeedCredentials = pgTable(
  'sales_feed_credentials',
  {
    platform: enumText('platform').primaryKey(),
    keyCiphertext: bytea('key_ciphertext').notNull(),
    keyVersion: text('key_version').notNull(),
    state: enumText('state').notNull(),
    /** `SalesFeedCapability[]` the verification found open for this key. */
    capabilities: jsonb('capabilities').notNull().default([]),
    lastErrorKind: enumText('last_error_kind'),
    verifiedAt: timestampTz('verified_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('sales_feed_credentials', t.platform, PlatformSchema.options),
    enumCheck(
      'sales_feed_credentials',
      t.state,
      SalesFeedStateSchema.options.filter((state) => state !== 'not_connected'),
    ),
    enumCheck('sales_feed_credentials', t.lastErrorKind, SalesFeedErrorKindSchema.options),
  ],
);

/**
 * The platform's webhook for Impera (ADR 0050 § 3), registered from Réglages once the key is connected: its id at the
 * platform and the secret it signs deliveries with, sealed like the key (context `sales_feed_webhook:<platform>`), out
 * of RLS and revoked from `nirvana_app`.
 */
export const salesFeedWebhooks = pgTable(
  'sales_feed_webhooks',
  {
    platform: enumText('platform').primaryKey(),
    platformWebhookId: text('platform_webhook_id').notNull(),
    secretCiphertext: bytea('secret_ciphertext').notNull(),
    keyVersion: text('key_version').notNull(),
    /** The address given to the platform, as it was given. */
    url: text('url').notNull(),
    lastDeliveryAt: timestampTz('last_delivery_at'),
    /** The last delivery refused (signature, time, shape): the hour only, nothing of its body. */
    lastRejectedAt: timestampTz('last_rejected_at'),
    createdAt: createdAt(),
  },
  (t) => [enumCheck('sales_feed_webhooks', t.platform, PlatformSchema.options)],
);

/**
 * The inbox of the webhook: one row per checked delivery, its id telling a second sending of it. It holds no line of
 * the register: a delivery only wakes the reading by cursor, which records the lines in the register's order. Pruned
 * after a week; out of RLS, revoked from `nirvana_app` (the webhook route writes it through the admin role).
 */
export const salesFeedDeliveries = pgTable(
  'sales_feed_deliveries',
  {
    platform: enumText('platform').notNull(),
    deliveryId: text('delivery_id').notNull(),
    /** The platform's event, as it named it (`sale_created`, `sale_refunded`, or one Impera does not know yet). */
    event: text('event').notNull(),
    /** The register's position the delivery announced. */
    position: text('position').notNull(),
    receivedAt: timestampTz('received_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.platform, t.deliveryId] }),
    index('sales_feed_deliveries_received_idx').on(t.receivedAt),
    enumCheck('sales_feed_deliveries', t.platform, PlatformSchema.options),
  ],
);

/**
 * Where the reading of a platform's register stands: moved only in the transaction that records the lines it read
 * (ADR 0050 § 3), so a crash between the two loses and doubles nothing. Agency-level, out of RLS, nothing secret.
 */
export const salesFeedCursors = pgTable(
  'sales_feed_cursors',
  {
    platform: enumText('platform').primaryKey(),
    /** The platform's opaque position of the last line recorded; `null` reads from the start of the register. */
    position: text('position'),
    readAt: timestampTz('read_at'),
    /**
     * When a read last reached the end of the register, nothing more to read (ADR 0073 § 2): a report's check is
     * complete only once this is past its shift's window plus a quarter of an hour.
     */
    caughtUpAt: timestampTz('caught_up_at'),
    /** A 429's `Retry-After`: no read before this. */
    pausedUntil: timestampTz('paused_until'),
    /**
     * When the daily statistics were last read over 31 days (ADR 0081 § 3): before it, or before the key was verified
     * again, the next hourly reading takes the 31 days.
     */
    statsFullReadAt: timestampTz('stats_full_read_at'),
    updatedAt: updatedAt(),
  },
  (t) => [enumCheck('sales_feed_cursors', t.platform, PlatformSchema.options)],
);

/** The owner's link of a platform's model to a creator account (ADR 0050 § 3): a line of an unlinked model waits aside. */
export const salesFeedModels = pgTable(
  'sales_feed_models',
  {
    platform: enumText('platform').notNull(),
    platformModelId: text('platform_model_id').notNull(),
    platformAccountId: uuid('platform_account_id').notNull(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    linkedBy: text('linked_by'),
    linkedAt: timestampTz('linked_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'sales_feed_models_pk', columns: [t.platform, t.platformModelId] }),
    unique('sales_feed_models_account_unique').on(t.platformAccountId),
    foreignKey({
      name: 'sales_feed_models_account_creator_fk',
      columns: [t.platformAccountId, t.creatorId],
      foreignColumns: [platformAccounts.id, platformAccounts.creatorId],
    }),
    enumCheck('sales_feed_models', t.platform, PlatformSchema.options),
  ],
);

/**
 * The models the owner set aside from the import review (ADR 0069 § 1, CRM-07): a line set aside does not come back
 * among the proposals, and stays in « Écartées », from where it can be taken back (the row is deleted). One per model;
 * a model linked since has none. Agency-level, of no creator: never a creator's own account (`agencyOnly`).
 */
export const salesFeedModelDismissals = pgTable(
  'sales_feed_model_dismissals',
  {
    platform: enumText('platform').notNull(),
    platformModelId: text('platform_model_id').notNull(),
    dismissedBy: text('dismissed_by'),
    dismissedAt: timestampTz('dismissed_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'sales_feed_model_dismissals_pk', columns: [t.platform, t.platformModelId] }),
    enumCheck('sales_feed_model_dismissals', t.platform, PlatformSchema.options),
    check('sales_feed_model_dismissals_id_check', sql`char_length(${t.platformModelId}) between 1 and 200`),
    agencyOnly(),
  ],
);

/**
 * What the platform's model list showed last (ADR 0069 § 5, CRM-07 a2), one row per model ever listed: its status, and
 * when it was first and last listed. The badge « N nouvelles créatrices » counts the listed ones with no link and not
 * set aside; a linked model gone from the list or `banned` is signalled once (`goneSignalledAt`, `bannedSignalledAt`,
 * cleared when it comes back). Nothing is ever deleted for it. Agency-level, of no creator (`agencyOnly`).
 */
export const salesFeedModelSightings = pgTable(
  'sales_feed_model_sightings',
  {
    platform: enumText('platform').notNull(),
    platformModelId: text('platform_model_id').notNull(),
    status: enumText('status').notNull(),
    isActive: boolean('is_active').notNull(),
    firstSeenAt: timestampTz('first_seen_at').notNull().defaultNow(),
    lastSeenAt: timestampTz('last_seen_at').notNull().defaultNow(),
    goneSignalledAt: timestampTz('gone_signalled_at'),
    bannedSignalledAt: timestampTz('banned_signalled_at'),
  },
  (t) => [
    primaryKey({ name: 'sales_feed_model_sightings_pk', columns: [t.platform, t.platformModelId] }),
    enumCheck('sales_feed_model_sightings', t.platform, PlatformSchema.options),
    enumCheck('sales_feed_model_sightings', t.status, PlatformModelStatusSchema.options),
    check('sales_feed_model_sightings_id_check', sql`char_length(${t.platformModelId}) between 1 and 200`),
    agencyOnly(),
  ],
);

/**
 * The owner's link of a platform's team member (ADR 0050 § 5): one of the team, or the agent (the platform's bot,
 * whose sales earn no commission). Pay reads it through `salesFeedReadsForPay` (CRM-03), with its version.
 */
export const salesFeedChatters = pgTable(
  'sales_feed_chatters',
  {
    platform: enumText('platform').notNull(),
    platformChatterId: text('platform_chatter_id').notNull(),
    kind: enumText('kind').notNull(),
    memberId: uuid('member_id').references(() => teamMembers.id),
    /**
     * Changes whenever the link points elsewhere (another member, the agent), never when the same link is posed again:
     * pay freezes it in a statement's inputs (CRM-03), so a link changed after a statement shows in its `inputs_hash`.
     */
    linkVersion: uuid('link_version').notNull().defaultRandom(),
    /**
     * When `link_version` last changed (not `linked_at`, which moves each time the same link is posed): a link posed
     * after a period's closing is an attribution that counts in the first period still open (ADR 0050 § 5, ADR 0032).
     */
    linkVersionAt: timestampTz('link_version_at').notNull().defaultNow(),
    linkedBy: text('linked_by'),
    linkedAt: timestampTz('linked_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'sales_feed_chatters_pk', columns: [t.platform, t.platformChatterId] }),
    enumCheck('sales_feed_chatters', t.platform, PlatformSchema.options),
    enumCheck('sales_feed_chatters', t.kind, ['member', 'agent']),
    check('sales_feed_chatters_member_check', sql`(${t.kind} = 'member') = (${t.memberId} is not null)`),
    // Who sells is the agency's: a creator's own account never reads the links (CRM-04 lot d).
    agencyOnly(),
    // ADR 0076 § 4: a manager never poses, moves or undoes a link to his own record, before or after; the owner may.
    // Written through `withMember`, which sets the scope and the account; the admin role is not concerned.
    ...(['insert', 'update', 'delete'] as const).map((command) =>
      pgPolicy(`not_own_link_${command}`, {
        as: 'restrictive',
        for: command,
        ...(command === 'insert' ? {} : { using: notOwnLink(t.memberId) }),
        ...(command === 'delete' ? {} : { withCheck: notOwnLink(t.memberId) }),
      }),
    ),
  ],
);

/**
 * What the review of a platform's team keeps besides the links (ADR 0076): the owner's or a manager's decision on an
 * account without a link (`none`, confirmed nobody; `dismissed`, set aside, can be taken back), and what the reading
 * of the platform's list saw (`platform_removed_at`, `absent_since`), so that a removal is an alert as long as it lasts
 * and never a deletion. One row per account seen; nothing of a person but the platform's id.
 */
export const salesFeedChatterReviews = pgTable(
  'sales_feed_chatter_reviews',
  {
    platform: enumText('platform').notNull(),
    platformChatterId: text('platform_chatter_id').notNull(),
    decision: enumText('decision'),
    decidedBy: text('decided_by'),
    decidedAt: timestampTz('decided_at'),
    /** The platform's `removedAt`, as last read. */
    platformRemovedAt: timestampTz('platform_removed_at'),
    /** Since when a complete, believed reading no longer lists the account; cleared when it comes back. */
    absentSince: timestampTz('absent_since'),
    /** The platform's `isBot` as last read: an API key's bot never makes the « new chatter » badge (§ 6). */
    isBot: boolean('is_bot').notNull().default(false),
    firstSeenAt: timestampTz('first_seen_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'sales_feed_chatter_reviews_pk', columns: [t.platform, t.platformChatterId] }),
    enumCheck('sales_feed_chatter_reviews', t.platform, PlatformSchema.options),
    enumCheck('sales_feed_chatter_reviews', t.decision, ['none', 'dismissed']),
    check(
      'sales_feed_chatter_reviews_decided_check',
      sql`(${t.decision} is null) = (${t.decidedAt} is null)`,
    ),
    check('sales_feed_chatter_reviews_id_check', sql`char_length(${t.platformChatterId}) between 1 and 200`),
    agencyOnly(),
  ],
);

/**
 * The last reading of a platform's team list (ADR 0076 § 5): how many accounts it listed, and whether it was believed.
 * A list that came back empty, or lost more than half its accounts at once, is one « lecture anormale » alert, and no
 * account is taken as gone on its word. One row per platform, updated at each reading.
 */
export const salesFeedTeamReadings = pgTable(
  'sales_feed_team_readings',
  {
    platform: enumText('platform').primaryKey(),
    readAt: timestampTz('read_at').notNull(),
    listed: integer('listed').notNull(),
    abnormal: boolean('abnormal').notNull(),
  },
  (t) => [
    enumCheck('sales_feed_team_readings', t.platform, PlatformSchema.options),
    check('sales_feed_team_readings_listed_check', sql`${t.listed} >= 0`),
    agencyOnly(),
  ],
);

/** The columns a line of the register has, whether it is recorded or waits in quarantine. */
const lineColumns = () => ({
  platform: enumText('platform').notNull(),
  platformSaleId: text('platform_sale_id').notNull(),
  event: enumText('event').notNull(),
  saleType: enumText('sale_type').notNull(),
  /** The platform's value when `sale_type` is `other`. */
  rawType: text('raw_type'),
  /** The sale's status when the line was read (a later refund comes as its own line). */
  status: enumText('status').notNull(),
  rawStatus: text('raw_status'),
  occurredAt: timestampTz('occurred_at').notNull(),
  platformModelId: text('platform_model_id').notNull(),
  platformChatterId: text('platform_chatter_id'),
  /** The fan's id at the platform, never his pseudo. */
  platformFanId: text('platform_fan_id'),
  currency: text('currency').notNull(),
  grossInclVatMinor: integer('gross_incl_vat_minor').notNull(),
  grossExclVatMinor: integer('gross_excl_vat_minor').notNull(),
  netMinor: integer('net_minor').notNull(),
  agencyMinor: integer('agency_minor').notNull(),
  creatorMinor: integer('creator_minor').notNull(),
  /** The register's position of the line. */
  position: text('position').notNull(),
  /**
   * SHA-256 of what the line says (type, date, model, author, fan, currency, amounts): the same line read again with
   * another hash is signalled (`line_changed`) and the first one stays.
   */
  inputsHash: text('inputs_hash').notNull(),
});

/**
 * The register of sales and refunds of linked models (ADR 0050 § 3), append-only (trigger in the migration): one
 * line per sale and event, a refund never rewrites its sale. Written inside `withTenant` of the creator the model is
 * linked to.
 */
export const platformSales = pgTable(
  'platform_sales',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    platformAccountId: uuid('platform_account_id').notNull(),
    ...lineColumns(),
    recordedAt: timestampTz('recorded_at').notNull().defaultNow(),
  },
  (t) => [
    unique('platform_sales_line_unique').on(t.platform, t.platformSaleId, t.event),
    foreignKey({
      name: 'platform_sales_account_creator_fk',
      columns: [t.platformAccountId, t.creatorId],
      foreignColumns: [platformAccounts.id, platformAccounts.creatorId],
    }),
    enumCheck('platform_sales', t.platform, PlatformSchema.options),
    enumCheck('platform_sales', t.event, SaleEventSchema.options),
    enumCheck('platform_sales', t.saleType, SaleTypeSchema.options),
    enumCheck('platform_sales', t.status, SaleStatusSchema.options),
    enumCheck('platform_sales', t.currency, CurrencySchema.options),
    check('platform_sales_net_check', sql`${t.netMinor} = ${t.agencyMinor} + ${t.creatorMinor}`),
    check(
      'platform_sales_amounts_check',
      sql`${t.agencyMinor} >= 0 and ${t.creatorMinor} >= 0 and ${t.netMinor} <= ${t.grossExclVatMinor} and ${t.grossExclVatMinor} <= ${t.grossInclVatMinor}`,
    ),
    index('platform_sales_creator_occurred_idx').on(t.creatorId, t.occurredAt),
    index('platform_sales_account_chatter_idx').on(t.platformAccountId, t.platformChatterId, t.occurredAt),
    tenantPolicy(t.creatorId),
    // Her own account reads her sales through `creator_sales` alone, which names neither the chatter nor the platform's
    // fan (CRM-04 lot d, ADR 0042 § 2).
    closedToCreator(),
  ],
);

/**
 * Lines of a model linked to no creator account (ADR 0050 § 3): counted nowhere, kept until the owner links the
 * model, then moved to `platform_sales` and marked released. Agency-level, of no creator: RLS only closes it to a
 * creator's own account (`agencyOnly`).
 */
export const platformSalesQuarantine = pgTable(
  'platform_sales_quarantine',
  {
    id: id(),
    ...lineColumns(),
    recordedAt: timestampTz('recorded_at').notNull().defaultNow(),
    releasedAt: timestampTz('released_at'),
  },
  (t) => [
    unique('platform_sales_quarantine_line_unique').on(t.platform, t.platformSaleId, t.event),
    index('platform_sales_quarantine_waiting_idx')
      .on(t.platform, t.platformModelId)
      .where(sql`${t.releasedAt} is null`),
    enumCheck('platform_sales_quarantine', t.platform, PlatformSchema.options),
    enumCheck('platform_sales_quarantine', t.event, SaleEventSchema.options),
    enumCheck('platform_sales_quarantine', t.saleType, SaleTypeSchema.options),
    enumCheck('platform_sales_quarantine', t.status, SaleStatusSchema.options),
    enumCheck('platform_sales_quarantine', t.currency, CurrencySchema.options),
    check('platform_sales_quarantine_net_check', sql`${t.netMinor} = ${t.agencyMinor} + ${t.creatorMinor}`),
    check(
      'platform_sales_quarantine_amounts_check',
      sql`${t.agencyMinor} >= 0 and ${t.creatorMinor} >= 0 and ${t.netMinor} <= ${t.grossExclVatMinor} and ${t.grossExclVatMinor} <= ${t.grossInclVatMinor}`,
    ),
    // Lines of no creator, with their chatter and the platform's fan: never a creator's own account (CRM-04 lot d).
    agencyOnly(),
  ],
);

/**
 * The reports of the reliability check (ADR 0050 § 8, CRM-02), one per check, never rewritten: the switch of an
 * account to the platform's net (CRM-03) rests on the latest clean one. `report` is the answer as the owner saw it
 * (`SalesFeedCheckReport`: totals, models, team members, no fan data); the export itself is never kept. Agency-level,
 * of no creator: RLS only closes it to a creator's own account (`agencyOnly`).
 */
export const salesFeedChecks = pgTable(
  'sales_feed_checks',
  {
    id: id(),
    platform: enumText('platform').notNull(),
    fromDay: date('from_day').notNull(),
    toDay: date('to_day').notNull(),
    verdict: enumText('verdict').notNull(),
    /** A match with no bot outside the agent nor model of the export unknown (`isCleanMatch`). */
    clean: boolean('clean').notNull(),
    report: jsonb('report').notNull(),
    checkedBy: text('checked_by'),
    generatedAt: timestampTz('generated_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('sales_feed_checks_latest_idx').on(t.platform, t.generatedAt),
    enumCheck('sales_feed_checks', t.platform, PlatformSchema.options),
    enumCheck('sales_feed_checks', t.verdict, SalesFeedCheckVerdictSchema.options),
    check('sales_feed_checks_days_check', sql`${t.fromDay} <= ${t.toDay}`),
    check('sales_feed_checks_clean_check', sql`not ${t.clean} or ${t.verdict} = 'match'`),
    // A report names each team member and what the switch changes for him: never a creator's own account.
    agencyOnly(),
  ],
);

const currentCreator: SQL = sql`nullif(current_setting('app.creator_id', true), '')::uuid`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const notCreatorAccount: SQL = sql`current_setting('app.account_role', true) is distinct from 'creator'`;

/**
 * The platform's statistics of a creator account's day (ADR 0081): counters only, never an amount (the money stays
 * in `platform_sales`), never a fan nor a chatter. Rewritten at each reading, the platform's last word on the day;
 * `null` is « not computed yet » at the platform, never 0. Written by `connector.read_daily_stats` alone, through
 * `withAdmin` (no write policy: `nirvana_app` writes nothing). Read inside `withTenantMember` of her creator: the
 * owner, or an active manager when she is on his list (ADR 0081 § 5); never a chatter, a creator nor an operator.
 */
export const platformDailyStats = pgTable(
  'platform_daily_stats',
  {
    platform: enumText('platform').notNull(),
    platformAccountId: uuid('platform_account_id').notNull(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id),
    /** The platform's day, in its own zone (`salesFeedTimeZone`). */
    day: date('day').notNull(),
    newSubscribers: integer('new_subscribers').notNull(),
    unsubscribes: integer('unsubscribes'),
    activeSubscribers: integer('active_subscribers').notNull(),
    renewals: integer('renewals'),
    ppvSent: integer('ppv_sent'),
    ppvPurchased: integer('ppv_purchased').notNull(),
    messagesSent: integer('messages_sent'),
    messagesReceived: integer('messages_received'),
    readAt: timestampTz('read_at').notNull(),
  },
  (t) => [
    primaryKey({ name: 'platform_daily_stats_pk', columns: [t.platformAccountId, t.day] }),
    foreignKey({
      name: 'platform_daily_stats_account_creator_fk',
      columns: [t.platformAccountId, t.creatorId],
      foreignColumns: [platformAccounts.id, platformAccounts.creatorId],
    }),
    index('platform_daily_stats_creator_day_idx').on(t.creatorId, t.day),
    enumCheck('platform_daily_stats', t.platform, PlatformSchema.options),
    check(
      'platform_daily_stats_counts_check',
      sql`${t.newSubscribers} >= 0 and ${t.activeSubscribers} >= 0 and ${t.ppvPurchased} >= 0 and coalesce(${t.unsubscribes}, 0) >= 0 and coalesce(${t.renewals}, 0) >= 0 and coalesce(${t.ppvSent}, 0) >= 0 and coalesce(${t.messagesSent}, 0) >= 0 and coalesce(${t.messagesReceived}, 0) >= 0`,
    ),
    pgPolicy('stats_read', {
      for: 'select',
      using: sql`${notCreatorAccount} and ${t.creatorId} = ${currentCreator} and (${currentScope} = 'owner' or (${currentScope} = 'agency' and exists (select 1 from "user" u where u.id = ${currentUser} and ${t.creatorId} = any(u.creator_ids))))`,
    }),
  ],
);

/**
 * The calls made to a platform's statistics on one of its days (ADR 0081 § 3), by the daily reading and by the check
 * of CRM-02 alike, counted before each call: the reading makes none when fewer than 100 of the agency's 500 are left.
 * Agency-level, read and written through `withAdmin` only: no policy, and `nirvana_app` has no right on it.
 */
export const salesFeedStatsCalls = pgTable(
  'sales_feed_stats_calls',
  {
    platform: enumText('platform').notNull(),
    day: date('day').notNull(),
    calls: integer('calls').notNull(),
  },
  (t) => [
    primaryKey({ name: 'sales_feed_stats_calls_pk', columns: [t.platform, t.day] }),
    enumCheck('sales_feed_stats_calls', t.platform, PlatformSchema.options),
    check('sales_feed_stats_calls_calls_check', sql`${t.calls} >= 0`),
  ],
).enableRLS();
