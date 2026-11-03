import { z } from 'zod';

import { PlatformSchema } from './enums';
import { FanIdSchema, PlatformAccountIdSchema, TeamMemberIdSchema } from './ids';
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
   * The platform's webhook for Impera, `null` when none is registered: a sale then shows within a minute (the
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
  /** An answer whose shape Impera does not read: the cursor did not move. */
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
 * An account of the platform in Impera that a model can be linked to: exactly the ones `PUT …/models/:id` accepts.
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
 * statistics only. The export is read for this answer and kept nowhere; the report is kept (`SalesFeedLastCheck`).
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

/**
 * `match`: the three sources say the register's figures and nothing was left uncompared; `incomplete`: what was compared
 * matches, but a source, a model of the export or days before the register were not; `mismatch`: a net differs.
 */
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
 * with the owner's link. `differs` compares the net only: the count is shown, as Reveal does not say whether its
 * `salesCount` takes a refund off. `platformChatterId` `null` gathers the sales of nobody. `isBot` is the platform's flag:
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
  /**
   * Refunds in the days whose sale is not among the lines read: a sale before the days checked, or older than the
   * register. The statistics took them off that sale's day, outside the days compared.
   */
  z.object({ kind: z.literal('refund_without_sale'), count: z.number().int().min(1) }),
  /** A bot of the platform not linked to the agent: its sales would count for nobody, or for a member. */
  z.object({ kind: z.literal('bot_not_linked_to_agent'), platformChatterId: z.string().min(1) }),
  /** A model of the export that is neither a model id nor a handle of the platform's: its rows are left out. */
  z.object({ kind: z.literal('export_unknown_model'), model: z.string().min(1).max(100) }),
  /** Rows of the export outside the days checked, left out. */
  z.object({ kind: z.literal('export_rows_outside'), count: z.number().int().min(1) }),
  /** The statistics could not be read: the register is compared with the export only. */
  z.object({ kind: z.literal('stats_unavailable'), errorKind: SalesFeedErrorKindSchema }),
  /**
   * The register's oldest line is after the first day checked: the reading has not reached back that far (a key just
   * connected), or nothing was sold before. The days before `firstLineAt` cannot agree; they are not a divergence.
   */
  z.object({ kind: z.literal('register_starts_after'), firstLineAt: z.iso.datetime().nullable() }),
]);
export type SalesFeedCheckNote = z.infer<typeof SalesFeedCheckNoteSchema>;

/**
 * The reliability check of ADR 0050 § 8 (CRM-02): the register's `netAmount` against the statistics and the
 * dashboard's export, to the cent, per model and day, then per team member. It changes no amount and switches no
 * account; its report is kept, and the switch of an account (CRM-03) reads the latest one.
 */
export const SalesFeedCheckReportSchema = z.object({
  platform: PlatformSchema,
  from: z.iso.date(),
  to: z.iso.date(),
  timeZone: z.string().min(1),
  generatedAt: z.iso.datetime(),
  /**
   * When the register was last read from the platform. The export, downloaded by hand, should be taken just before
   * the check: a sale or a refund after it is in the register and the statistics, not in the file.
   */
  registerReadAt: z.iso.datetime().nullable(),
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
// Reports are kept (`sales_feed_checks`) and read back with this schema: add fields, optional, never remove one.

/**
 * `GET /v1/settings/sales-feeds/:platform/check`: the latest report kept, `null` before any check. `clean` is a match
 * over one whole fortnight, made once it was over, with no bot outside the agent nor model of the export unknown, the one a switch to the platform's net can rest on
 * (CRM-03); `checkedBy` the user who ran it.
 */
export const SalesFeedLastCheckSchema = z.object({
  last: z
    .object({
      report: SalesFeedCheckReportSchema,
      clean: z.boolean(),
      checkedBy: z.string().nullable(),
    })
    .nullable(),
});
export type SalesFeedLastCheck = z.infer<typeof SalesFeedLastCheckSchema>;

/**
 * Who sold a line of the register, by the owner's link of its platform chatter (ADR 0050 § 5, CRM-04): a member, the
 * agent (the platform's bot, no commission), a chatter nobody linked yet, or no chatter at all. A refund is its sale's
 * seller's. Never the fan. The creator never sees it (ADR 0053): her screens read their own view, which has no seller.
 */
export const SaleSellerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('member'), memberId: TeamMemberIdSchema }),
  z.object({ kind: z.literal('agent') }),
  z.object({ kind: z.literal('unlinked') }),
  z.object({ kind: z.literal('none') }),
]);
export type SaleSeller = z.infer<typeof SaleSellerSchema>;

/**
 * One row of the sales totals (CRM-04): an account's sales of one kind, by one seller, on one day, in one currency. The
 * day is the sale's in the platform's zone, and a refund is taken off its sale's day, as the platform's daily
 * statistics do (the rule of CRM-02). Sums only: no VAT nor commission is computed again (ADR 0050 § 8), and each
 * currency stays apart. The amounts are integer cents, a refund taken off, so they can be negative.
 */
export const SalesTotalsRowSchema = z.object({
  day: z.iso.date(),
  platform: PlatformSchema,
  platformAccountId: PlatformAccountIdSchema,
  currency: CurrencySchema,
  saleType: SaleTypeSchema,
  seller: SaleSellerSchema,
  sales: z.number().int().min(0),
  refunds: z.number().int().min(0),
  /** The « Chiffre d'affaires »: the price the fans paid, VAT included, refunds taken off (Reveal's `revenueTtc`). */
  grossInclVatMinor: signedCents,
  grossExclVatMinor: signedCents,
  /** What the agency and the creator share (`netAmount`). */
  netMinor: signedCents,
  agencyMinor: signedCents,
  /** The creator's part (`modelRevenue`, ADR 0050 § 8). */
  creatorMinor: signedCents,
});
export type SalesTotalsRow = z.infer<typeof SalesTotalsRowSchema>;

/**
 * A creator's sales totals from `from` to `to`, both days included. A refund of those days whose sale is older than the
 * register is counted in no row: `refundsWithoutSale` says how many, as CRM-02's note does.
 */
export const SalesTotalsSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  rows: z.array(SalesTotalsRowSchema),
  refundsWithoutSale: z.number().int().min(0),
});
export type SalesTotals = z.infer<typeof SalesTotalsSchema>;

/**
 * Where a refund's sale is, read on the platform's day (CRM-04): of the refund's own day (already taken off that day's
 * totals, so a digest adding the day's totals and its refunds counts it once), of an earlier day, or not in the
 * register (older than it, or not read yet).
 */
export const RefundedSaleSchema = z.enum(['same_day', 'earlier_day', 'not_in_register']);
export type RefundedSale = z.infer<typeof RefundedSaleSchema>;

/**
 * A day's refunds by their own day (CRM-04, the evening digest), whatever the day of their sale: the totals take a
 * refund off its sale's day, so a refund of an older sale is in no day's totals of today. One row per account,
 * currency, kind of sale, seller (the sale's, as in the totals) and where the sale is. The amounts are what was refunded, in integer
 * cents of `currency`, never negative. Never the fan.
 */
export const SalesRefundsRowSchema = z.object({
  platform: PlatformSchema,
  platformAccountId: PlatformAccountIdSchema,
  currency: CurrencySchema,
  saleType: SaleTypeSchema,
  seller: SaleSellerSchema,
  sale: RefundedSaleSchema,
  refunds: z.number().int().min(1),
  grossInclVatMinor: cents.min(0),
  grossExclVatMinor: cents.min(0),
  netMinor: cents.min(0),
  agencyMinor: cents.min(0),
  creatorMinor: cents.min(0),
});
export type SalesRefundsRow = z.infer<typeof SalesRefundsRowSchema>;

/** A creator's refunds of `day`, each on its own day in its platform's zone. */
export const SalesRefundsSchema = z.object({ day: z.iso.date(), rows: z.array(SalesRefundsRowSchema) });
export type SalesRefunds = z.infer<typeof SalesRefundsSchema>;

/**
 * How far the register of a platform where one of her accounts is linked has been read (ADR 0054: a day not read is
 * never a day without a sale). `readAt`: the last read that went through, `null` before any; `pausedUntil`: a 429
 * holds the reading until then. Nothing secret, no state of the key.
 */
export const SalesFeedReadingSchema = z.object({
  platform: PlatformSchema,
  readAt: z.iso.datetime().nullable(),
  pausedUntil: z.iso.datetime().nullable(),
});
export type SalesFeedReading = z.infer<typeof SalesFeedReadingSchema>;

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
  'sales_feed_check_days_unprocessable',
] as const;
export const SalesFeedErrorCodeSchema = z.enum(SALES_FEED_ERROR_CODES);
export type SalesFeedErrorCode = z.infer<typeof SalesFeedErrorCodeSchema>;

/**
 * A creator's own sales as her account reads them (CRM-04 lot d, ADR 0042 § 2, ADR 0054), from the view
 * `creator_sales`: the same rule as `SalesTotals` (a sale on its day in the platform's zone, a refund taken off its
 * sale's day, no VAT nor commission computed again, each currency apart), without the seller. Strict: a field of who
 * sold (member, agent, unlinked chatter) or of the platform's fan fails the contract.
 */
export const CreatorSalesRowSchema = z.strictObject({
  day: z.iso.date(),
  platform: PlatformSchema,
  platformAccountId: PlatformAccountIdSchema,
  currency: CurrencySchema,
  saleType: SaleTypeSchema,
  sales: z.number().int().min(0),
  refunds: z.number().int().min(0),
  grossInclVatMinor: signedCents,
  grossExclVatMinor: signedCents,
  netMinor: signedCents,
  agencyMinor: signedCents,
  /** Her part (`modelRevenue`, ADR 0050 § 8, ADR 0054). */
  creatorMinor: signedCents,
});
export type CreatorSalesRow = z.infer<typeof CreatorSalesRowSchema>;

/**
 * One line of her register in the range, a sale or a refund, on its sale's day: its own amounts as recorded (never
 * signed: `event` says a refund), and the fan's id in Impera only when his card is hers, else `null`. Never the
 * seller, never the platform's fan id.
 */
export const CreatorSaleLineSchema = z.strictObject({
  platform: PlatformSchema,
  platformAccountId: PlatformAccountIdSchema,
  event: SaleEventSchema,
  saleType: SaleTypeSchema,
  occurredAt: z.iso.datetime(),
  saleDay: z.iso.date(),
  currency: CurrencySchema,
  grossInclVatMinor: cents.min(0),
  grossExclVatMinor: cents.min(0),
  netMinor: cents.min(0),
  agencyMinor: cents.min(0),
  creatorMinor: cents.min(0),
  fanId: FanIdSchema.nullable(),
});
export type CreatorSaleLine = z.infer<typeof CreatorSaleLineSchema>;

/** Her sales from `from` to `to`, both days included; a refund whose sale is older than the register is only counted. */
export const CreatorSalesSchema = z.strictObject({
  from: z.iso.date(),
  to: z.iso.date(),
  rows: z.array(CreatorSalesRowSchema),
  lines: z.array(CreatorSaleLineSchema),
  refundsWithoutSale: z.number().int().min(0),
});
export type CreatorSales = z.infer<typeof CreatorSalesSchema>;
