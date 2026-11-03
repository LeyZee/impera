import { z } from 'zod';

import { PlatformSchema } from './enums';
import { CurrencySchema } from './money';

/**
 * The sales feed (ADR 0050 § 2): a platform's own register of sales and refunds, read by a stored cursor without any
 * captured session, through the port `PlatformSalesFeed` of the connectors module. Nothing here has a platform's shape:
 * each adapter maps its answers onto these types, and a value it does not know becomes `other`, kept and signalled.
 */

/** What a feed can do; an adapter declares its own, and a key may open only some of them (Reveal: Statistiques, Ventes). */
export const SalesFeedCapabilitySchema = z.enum(['sales', 'stats', 'team', 'webhooks']);
export type SalesFeedCapability = z.infer<typeof SalesFeedCapabilitySchema>;

/** One line of the register: a sale, or the refund of one (a chargeback included). Unique on sale and event. */
export const SaleEventSchema = z.enum(['sale', 'refund']);
export type SaleEvent = z.infer<typeof SaleEventSchema>;

/** What was sold (ADR 0050 § 6). A value the platform adds later reads as `other`, its raw value kept beside it. */
export const SaleTypeSchema = z.enum([
  'subscription',
  'renewal',
  'ppv',
  'mass_dm',
  'tip',
  'payment_link',
  'boudoir',
  'paid_message',
  'other',
]);
export type SaleType = z.infer<typeof SaleTypeSchema>;

/** The sale's status when it was read: a sale whose refund was asked still counts (ADR 0050 § 7). */
export const SaleStatusSchema = z.enum(['paid', 'refund_asked', 'refunded', 'other']);
export type SaleStatus = z.infer<typeof SaleStatusSchema>;

const cents = z.number().int();

/**
 * The amounts of a sale in integer cents of `currency`, as the platform computed them. `net` is what the agency and the
 * creator share (`agency` + `creator`, checked by the adapter): the base of a Reveal account in source « détectée »
 * (ADR 0050 § 8). A refund carries the amounts of its sale, to take off.
 */
export const SaleAmountsSchema = z
  .object({
    grossInclVat: cents.min(0),
    grossExclVat: cents.min(0),
    net: cents.min(0),
    agency: cents.min(0),
    creator: cents.min(0),
  })
  .refine((amounts) => amounts.net === amounts.agency + amounts.creator, {
    message: 'netAmount ≠ agency + model',
  })
  // What the platform keeps comes out of the price before VAT, which VAT only adds to: a field swapped on the platform's
  // side stops the reading instead of reaching pay.
  .refine((amounts) => amounts.net <= amounts.grossExclVat && amounts.grossExclVat <= amounts.grossInclVat, {
    message: 'net ≤ amountHt ≤ amountTtc broken',
  });
export type SaleAmounts = z.infer<typeof SaleAmountsSchema>;

/**
 * One line of a platform's register. Identifiers stay the platform's opaque strings; the fan is his id only, never his
 * pseudo (fan data stays out of the logs, ADR 0050 § 4), and `null` for a purchase without an account.
 */
export const PlatformSaleSchema = z.object({
  /** Where the line sits in the register: what the stored cursor moves to. */
  position: z.string().min(1),
  platformSaleId: z.string().min(1),
  event: SaleEventSchema,
  type: SaleTypeSchema,
  /** The platform's value when `type` is `other`, so that it can be signalled and mapped later. */
  rawType: z.string().min(1).nullable(),
  status: SaleStatusSchema,
  rawStatus: z.string().min(1).nullable(),
  /** The sale's date, or the refund's for a refund: what a line is dated on. */
  occurredAt: z.iso.datetime(),
  platformModelId: z.string().min(1),
  /** The platform's author of the sale (ADR 0050 § 5), `null` for a sale of nobody. */
  platformChatterId: z.string().min(1).nullable(),
  platformFanId: z.string().min(1).nullable(),
  currency: CurrencySchema,
  amounts: SaleAmountsSchema,
});
export type PlatformSale = z.infer<typeof PlatformSaleSchema>;

/** A page of the register after a position, in the register's order (not the sales' dates). */
export const PlatformSalesPageSchema = z.object({
  sales: z.array(PlatformSaleSchema),
  /** The position to read after next time; the one given when the page is empty. */
  endPosition: z.string().min(1).nullable(),
  hasMore: z.boolean(),
});
export type PlatformSalesPage = z.infer<typeof PlatformSalesPageSchema>;

/** A creator account as the platform lists it, for the owner's mapping. */
export const PlatformModelSchema = z.object({
  platformModelId: z.string().min(1),
  handle: z.string().min(1),
  displayName: z.string(),
  isActive: z.boolean(),
});
export type PlatformModel = z.infer<typeof PlatformModelSchema>;

/** A member of the platform's team, for the owner's mapping to a team member (ADR 0050 § 5). */
export const PlatformChatterSchema = z.object({
  platformChatterId: z.string().min(1),
  firstName: z.string(),
  lastName: z.string(),
  isBot: z.boolean(),
  isExternal: z.boolean(),
  removedAt: z.iso.datetime().nullable(),
  platformModelIds: z.array(z.string().min(1)),
});
export type PlatformChatter = z.infer<typeof PlatformChatterSchema>;

const count = z.number().int().min(0);

/**
 * A creator account's day at the platform (its own time zone and its own definitions), in integer cents. Counters the
 * platform computes later read `null` until then.
 */
export const PlatformDailyStatSchema = z.object({
  date: z.iso.date(),
  platformModelId: z.string().min(1),
  newSubscribers: count,
  activeSubscribers: count,
  revenueInclVat: count,
  revenueExclVat: count,
  agency: count,
  creator: count,
  ppvPurchased: count,
  ppvSent: count.nullable(),
  messagesSent: count.nullable(),
  messagesReceived: count.nullable(),
});
export type PlatformDailyStat = z.infer<typeof PlatformDailyStatSchema>;

/** A platform team member's day on one creator account; `platformChatterId` `null` gathers the sales of nobody. */
export const PlatformChatterDailyStatSchema = z.object({
  date: z.iso.date(),
  platformChatterId: z.string().min(1).nullable(),
  platformModelId: z.string().min(1),
  salesCount: count,
  revenueInclVat: count,
  agency: count,
  creator: count,
  ppvPurchased: count,
  ppvSent: count.nullable(),
  messagesSent: count.nullable(),
});
export type PlatformChatterDailyStat = z.infer<typeof PlatformChatterDailyStatSchema>;

/** Why the feed stopped or a key was refused; each kind has one French sentence (connectors, `sales-feed-messages.ts`). */
export const SalesFeedErrorKindSchema = z.enum([
  'malformed',
  'unauthorized',
  'missing_access',
  'rate_limited',
  'unreachable',
  'unexpected_answer',
]);
export type SalesFeedErrorKind = z.infer<typeof SalesFeedErrorKindSchema>;

export const SalesFeedStateSchema = z.enum(['not_connected', 'connected', 'needs_reconnect']);
export type SalesFeedState = z.infer<typeof SalesFeedStateSchema>;

/** A platform's model with the creator account it counts for, `null` while the owner has not linked it. */
export const SalesFeedModelLinkSchema = z.object({
  platformModelId: z.string().min(1),
  handle: z.string().min(1),
  displayName: z.string(),
  platformAccountId: z.uuid().nullable(),
  /**
   * Who posed the link, null when there is none: `auto` when the handle matched one account at connection, a link
   * that decides whose sales these are and that the owner checks; `member` when the owner chose it.
   */
  linkedBy: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('auto') }),
      z.object({ kind: z.literal('member'), userId: z.string().min(1) }),
    ])
    .nullable(),
  /**
   * Sales of this model waiting in quarantine, counted nowhere until it is linked (ADR 0050 § 3); linking the model
   * moves every one of them into the register, in the same transaction.
   */
  quarantined: z.number().int().min(0),
});
export type SalesFeedModelLink = z.infer<typeof SalesFeedModelLinkSchema>;

/** The Réglages line of a platform's feed. Never the key, even masked (ADR 0050 § 4). */
export const SalesFeedStatusSchema = z.object({
  platform: PlatformSchema,
  state: SalesFeedStateSchema,
  capabilities: z.array(SalesFeedCapabilitySchema),
  verifiedAt: z.iso.datetime().nullable(),
  /** The last read of the register that went through. */
  lastReadAt: z.iso.datetime().nullable(),
  lastErrorKind: SalesFeedErrorKindSchema.nullable(),
  message: z.string().min(1),
  /** Lines waiting for a model the owner has not linked yet. */
  quarantined: z.number().int().min(0),
  /**
   * The platform's webhook for Nirvana, `null` when none is registered: a sale then shows within a minute (the
   * cursor), within seconds with it. `lastDeliveryAt` is the last delivery that passed its signature check;
   * `lastRejectedAt` the last one refused since the webhook was registered (an old secret, a forged one): the one case
   * where the owner has something to do, register it again. No delivery for hours only means no sale.
   */
  webhook: z
    .object({
      createdAt: z.iso.datetime(),
      lastDeliveryAt: z.iso.datetime().nullable(),
      lastRejectedAt: z.iso.datetime().nullable(),
    })
    .nullable(),
});
export type SalesFeedStatus = z.infer<typeof SalesFeedStatusSchema>;

export const SaveSalesFeedKeyBodySchema = z.object({ key: z.string().trim().min(1).max(512) });
export type SaveSalesFeedKeyBody = z.infer<typeof SaveSalesFeedKeyBodySchema>;

export const SalesFeedRefusalSchema = z.object({
  kind: SalesFeedErrorKindSchema,
  message: z.string().min(1),
});
export type SalesFeedRefusal = z.infer<typeof SalesFeedRefusalSchema>;

export const LinkSalesFeedModelBodySchema = z.object({ platformAccountId: z.uuid().nullable() });
export type LinkSalesFeedModelBody = z.infer<typeof LinkSalesFeedModelBodySchema>;

/**
 * The owner's mapping of a platform's team member (ADR 0050 § 5): a team member, the agent (the platform's bot), or
 * nobody yet. Read by pay later (CRM-03); a sale is never attributed here.
 */
export const LinkSalesFeedChatterBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('member'), memberId: z.uuid() }),
  z.object({ kind: z.literal('agent') }),
  z.object({ kind: z.literal('none') }),
]);
export type LinkSalesFeedChatterBody = z.infer<typeof LinkSalesFeedChatterBodySchema>;

/** What a feed signals to the owner, with no fan data: the register is read for the agency, not one creator. */
export const SalesFeedSignalSchema = z.discriminatedUnion('kind', [
  /** A 401 or 403: reading stopped, the key must be connected again (ADR 0050 § 3). */
  z.object({ kind: z.literal('needs_reconnect'), errorKind: SalesFeedErrorKindSchema }),
  /** A value the adapter does not know: a type or status read as `other`, an event skipped (the cursor moves on). */
  z.object({
    kind: z.literal('unknown_value'),
    field: z.enum(['event', 'type', 'status']),
    value: z.string().min(1).max(100),
  }),
  /** A line for a model no creator account is linked to, kept aside and counted nowhere. */
  z.object({ kind: z.literal('model_unlinked'), platformModelId: z.string().min(1).max(200) }),
  /** A line read again with other amounts or another author than the one recorded: the first one stays. */
  z.object({
    kind: z.literal('line_changed'),
    platformSaleId: z.string().min(1).max(200),
    event: SaleEventSchema,
  }),
  /** An answer whose shape Nirvana does not read: the cursor did not move. */
  z.object({ kind: z.literal('unexpected_answer') }),
]);
export type SalesFeedSignal = z.infer<typeof SalesFeedSignalSchema>;

/** A platform's team member with the owner's link, for the mapping list. */
export const SalesFeedChatterLinkSchema = PlatformChatterSchema.extend({
  link: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('member'), memberId: z.uuid() }),
      z.object({ kind: z.literal('agent') }),
    ])
    .nullable(),
});
export type SalesFeedChatterLink = z.infer<typeof SalesFeedChatterLinkSchema>;

/**
 * The Réglages page of a platform's feed: its line, its models and its team as the platform lists them now, with the
 * owner's links. `listError` says why the live lists are missing (no key, a refusal, an outage); the links stay.
 */
/**
 * An account of the platform in Nirvana that a model can be linked to: exactly the ones `PUT …/models/:id` accepts.
 * `linkedTo` is the model already linked to it, which refuses another (`sales_feed_model_conflict`).
 */
export const SalesFeedAccountChoiceSchema = z.object({
  platformAccountId: z.uuid(),
  handle: z.string().min(1),
  creatorDisplayName: z.string(),
  linkedTo: z.string().min(1).nullable(),
});
export type SalesFeedAccountChoice = z.infer<typeof SalesFeedAccountChoiceSchema>;

export const SalesFeedOverviewSchema = z.object({
  status: SalesFeedStatusSchema,
  models: z.array(SalesFeedModelLinkSchema),
  accounts: z.array(SalesFeedAccountChoiceSchema),
  chatters: z.array(SalesFeedChatterLinkSchema),
  listError: SalesFeedErrorKindSchema.nullable(),
});
export type SalesFeedOverview = z.infer<typeof SalesFeedOverviewSchema>;

/** Réglages › Connexions: one line per platform that has a sales feed. */
export const SalesFeedListSchema = z.object({ feeds: z.array(SalesFeedStatusSchema) });
export type SalesFeedList = z.infer<typeof SalesFeedListSchema>;

/** Reveal's statistics stop at 31 days a call: a check covers a fortnight, a month at most. */
export const SALES_FEED_CHECK_MAX_DAYS = 31;

/**
 * `POST /v1/settings/sales-feeds/:platform/check` (CRM-02, ADR 0050 § 8): the days to compare, in the platform's own
 * day, and the dashboard's export as the owner downloaded it (CSV text), or `null` to compare the register with the
 * statistics only. The export is read for this answer and kept nowhere.
 */
export const SalesFeedCheckBodySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    export: z.string().max(2_000_000).nullable(),
  })
  .refine((body) => body.from <= body.to, { message: 'from after to', path: ['to'] })
  .refine((body) => (Date.parse(body.to) - Date.parse(body.from)) / 86_400_000 < SALES_FEED_CHECK_MAX_DAYS, {
    message: `${String(SALES_FEED_CHECK_MAX_DAYS)} days at most`,
    path: ['to'],
  });
export type SalesFeedCheckBody = z.infer<typeof SalesFeedCheckBodySchema>;

const signedCents = z.number().int();

/**
 * Amounts of one source, in integer cents of the platform's currency. A figure the source does not give (a column the
 * export lacks) is `null` and is not compared; the register and the statistics give all four.
 */
export const SalesFeedCheckTotalsSchema = z.object({
  grossInclVat: signedCents.nullable(),
  agency: signedCents.nullable(),
  creator: signedCents.nullable(),
  net: signedCents.nullable(),
});
export type SalesFeedCheckTotals = z.infer<typeof SalesFeedCheckTotalsSchema>;

/** `match`: every source given says the register's figures; `incomplete`: what was compared matches, a source is missing. */
export const SalesFeedCheckVerdictSchema = z.enum(['match', 'mismatch', 'incomplete']);
export type SalesFeedCheckVerdict = z.infer<typeof SalesFeedCheckVerdictSchema>;

/**
 * One model's day, as the register (`netAmount` and its parts, a refund taken from its sale's day as the platform
 * does), the statistics and the export say it. `differs` names the sources that do not say the register's figures.
 */
export const SalesFeedCheckDaySchema = z.object({
  date: z.iso.date(),
  platformModelId: z.string().min(1),
  handle: z.string().nullable(),
  /** Linked to a creator account; the lines of an unlinked model wait in quarantine and are counted here too. */
  linked: z.boolean(),
  register: SalesFeedCheckTotalsSchema,
  stats: SalesFeedCheckTotalsSchema.nullable(),
  export: SalesFeedCheckTotalsSchema.nullable(),
  differs: z.array(z.enum(['stats', 'export'])),
});
export type SalesFeedCheckDay = z.infer<typeof SalesFeedCheckDaySchema>;

/**
 * A platform team member over the days checked (all models): what the register and the per-member statistics give,
 * with the owner's link. `platformChatterId` `null` gathers the sales of nobody. `isBot` is the platform's flag:
 * the agent's sales must come under the bot's own id (ADR 0050 § 5).
 */
export const SalesFeedCheckChatterSchema = z.object({
  platformChatterId: z.string().min(1).nullable(),
  isBot: z.boolean().nullable(),
  link: z.enum(['member', 'agent']).nullable(),
  register: z.object({ net: signedCents, sales: z.number().int() }),
  stats: z.object({ net: signedCents, sales: z.number().int() }).nullable(),
  differs: z.boolean(),
});
export type SalesFeedCheckChatter = z.infer<typeof SalesFeedCheckChatterSchema>;

/** What the owner should know beside the figures; never a fan's data. */
export const SalesFeedCheckNoteSchema = z.discriminatedUnion('kind', [
  /** Refunds in the days whose sale is older than the register: the statistics took them from a day not read. */
  z.object({ kind: z.literal('refund_without_sale'), count: z.number().int().min(1) }),
  /** A bot of the platform not linked to the agent: its sales would count for nobody, or for a member. */
  z.object({ kind: z.literal('bot_not_linked_to_agent'), platformChatterId: z.string().min(1) }),
  /** A model of the export that is neither a model id nor a handle of the platform's: its rows are left out. */
  z.object({ kind: z.literal('export_unknown_model'), model: z.string().min(1).max(100) }),
  /** Rows of the export outside the days checked, left out. */
  z.object({ kind: z.literal('export_rows_outside'), count: z.number().int().min(1) }),
  /** The statistics could not be read: the register is compared with the export only. */
  z.object({ kind: z.literal('stats_unavailable'), errorKind: SalesFeedErrorKindSchema }),
]);
export type SalesFeedCheckNote = z.infer<typeof SalesFeedCheckNoteSchema>;

/**
 * The reliability check of ADR 0050 § 8 (CRM-02): the register's `netAmount` against the statistics and the
 * dashboard's export, to the cent, per model and day, then per team member. Read-only: it writes nothing and changes
 * no amount; no account switches on it (CRM-03).
 */
export const SalesFeedCheckReportSchema = z.object({
  platform: PlatformSchema,
  from: z.iso.date(),
  to: z.iso.date(),
  timeZone: z.string().min(1),
  generatedAt: z.iso.datetime(),
  verdict: SalesFeedCheckVerdictSchema,
  total: z.object({
    register: SalesFeedCheckTotalsSchema,
    stats: SalesFeedCheckTotalsSchema.nullable(),
    export: SalesFeedCheckTotalsSchema.nullable(),
  }),
  days: z.array(SalesFeedCheckDaySchema),
  chatters: z.array(SalesFeedCheckChatterSchema),
  notes: z.array(SalesFeedCheckNoteSchema),
});
export type SalesFeedCheckReport = z.infer<typeof SalesFeedCheckReportSchema>;

/** The refusals of `/v1/settings/sales-feeds`, each with its French sentence in `message`. */
export const SALES_FEED_ERROR_CODES = [
  'sales_feed_not_found',
  'sales_feed_vault_unavailable',
  'sales_feed_account_unprocessable',
  'sales_feed_model_conflict',
  'sales_feed_member_unprocessable',
  'sales_feed_not_connected_conflict',
  'sales_feed_webhook_url_unprocessable',
  'sales_feed_delivery_unauthenticated',
  'sales_feed_webhook_not_found',
  'sales_feed_export_unprocessable',
] as const;
export const SalesFeedErrorCodeSchema = z.enum(SALES_FEED_ERROR_CODES);
export type SalesFeedErrorCode = z.infer<typeof SalesFeedErrorCodeSchema>;
