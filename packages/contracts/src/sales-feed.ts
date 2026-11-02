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

/** The refusals of `/v1/settings/sales-feeds`, each with its French sentence in `message`. */
export const SALES_FEED_ERROR_CODES = [
  'sales_feed_not_found',
  'sales_feed_vault_unavailable',
  'sales_feed_account_unprocessable',
  'sales_feed_model_conflict',
  'sales_feed_member_unprocessable',
] as const;
export const SalesFeedErrorCodeSchema = z.enum(SALES_FEED_ERROR_CODES);
export type SalesFeedErrorCode = z.infer<typeof SalesFeedErrorCodeSchema>;
