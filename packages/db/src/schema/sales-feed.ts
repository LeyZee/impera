import {
  CurrencySchema,
  PlatformSchema,
  SaleEventSchema,
  SaleStatusSchema,
  SaleTypeSchema,
  SalesFeedErrorKindSchema,
  SalesFeedStateSchema,
} from '@nirvana/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, enumCheck, enumText, id, tenantPolicy, timestampTz, updatedAt } from './columns';
import { teamMembers } from './team';
import { creators, platformAccounts } from './tenancy';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

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
 * The platform's webhook for Nirvana (ADR 0050 § 3), registered from Réglages once the key is connected: its id at the
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
    /** The platform's event, as it named it (`sale_created`, `sale_refunded`, or one Nirvana does not know yet). */
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
    /** A 429's `Retry-After`: no read before this. */
    pausedUntil: timestampTz('paused_until'),
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
    linkedBy: text('linked_by'),
    linkedAt: timestampTz('linked_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'sales_feed_chatters_pk', columns: [t.platform, t.platformChatterId] }),
    enumCheck('sales_feed_chatters', t.platform, PlatformSchema.options),
    enumCheck('sales_feed_chatters', t.kind, ['member', 'agent']),
    check('sales_feed_chatters_member_check', sql`(${t.kind} = 'member') = (${t.memberId} is not null)`),
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
  ],
);

/**
 * Lines of a model linked to no creator account (ADR 0050 § 3): counted nowhere, kept until the owner links the
 * model, then moved to `platform_sales` and marked released. Agency-level, out of RLS.
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
  ],
);
