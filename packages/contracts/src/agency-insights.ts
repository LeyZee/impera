import { z } from 'zod';

import { DashboardSalesSellerSchema } from './dashboard';
import { CreatorIdSchema } from './ids';

/**
 * `GET /v1/dashboard/agency` (ADR 0078): the agency's insights, read in the platforms' registers of sales (ADR 0050)
 * for the owner and an active manager. Money in integer euro cents (dollars at pay's last ECB rate, left out without
 * one), each day the platform's, a refund taken off its sale's day. Never a fan: no id, no pseudonym, no amount of
 * one fan.
 */

export const AgencyPeriodSchema = z.enum(['day', 'week', 'month', 'quarter']);
export type AgencyPeriod = z.infer<typeof AgencyPeriodSchema>;

/** Days a period counts, today included. */
export const AGENCY_PERIOD_DAYS: Readonly<Record<AgencyPeriod, number>> = {
  day: 1,
  week: 7,
  month: 30,
  quarter: 90,
};

export const AgencyInsightsQuerySchema = z.object({
  period: AgencyPeriodSchema.default('week'),
  /** One creator alone; absent, every creator the account reads with the team's scope. */
  creatorId: CreatorIdSchema.optional(),
});
export type AgencyInsightsQuery = z.infer<typeof AgencyInsightsQuerySchema>;

/**
 * What was sold, the way the screen groups it: a subscription and its renewals are one group (ADR 0078 § 4). The order
 * is the colours' order on the screen, fixed.
 */
export const AgencySaleKindSchema = z.enum([
  'subscriptions',
  'ppv',
  'mass_dm',
  'tips',
  'payment_links',
  'boudoir',
  'paid_messages',
  'other',
]);
export type AgencySaleKind = z.infer<typeof AgencySaleKindSchema>;

const cents = z.number().int();
const count = z.number().int().nonnegative();
const day = z.iso.date();

export const AgencyFiguresSchema = z.strictObject({
  /** The « Chiffre d'affaires »: what the fans paid, VAT included, refunds taken off. */
  revenueMinor: cents,
  /**
   * The same sales without the VAT the fans paid (ADR 0106 § 2): the revenue less it is the fans' VAT, it less the net
   * is the platform's commission.
   */
  revenueExclVatMinor: cents,
  netMinor: cents,
  agencyMinor: cents,
  creatorMinor: cents,
  /**
   * The VAT the platform adds to the agency's transfers on its part, estimated (ADR 0106 § 6): never added to a sum,
   * the exact amount is the platform's transfer statement.
   */
  agencyTransferVatMinor: cents,
  sales: count,
  refunds: count,
});
export type AgencyFigures = z.infer<typeof AgencyFiguresSchema>;

/** A count the platform gives later (« en calcul »): null until it has computed it. */
const later = count.nullable();

/**
 * One period's subscribers, PPV and messages, summed over the days the snapshot holds (ADR 0081). A field is null as
 * soon as one of those days still waits for the platform to compute it.
 */
export const AgencySubscriberFiguresSchema = z.strictObject({
  /** Active subscribers at the end of the period's last day (now, for today); null when that day is not read. */
  activeAtEnd: later,
  /** Active subscribers at the end of the day before the period; null when that day is not read. */
  activeBefore: later,
  newSubscribers: count,
  unsubscribes: later,
  renewals: later,
  /** Paid messages sent, the fans a paid Mass DM targeted included. */
  ppvSent: later,
  ppvPurchased: count,
  messagesSent: later,
  messagesReceived: later,
  /** Days of the period the snapshot holds for every account counted, and days of the period. */
  daysRead: count,
  days: count,
});
export type AgencySubscriberFigures = z.infer<typeof AgencySubscriberFiguresSchema>;

export const AgencySubscribersSchema = z.strictObject({
  current: AgencySubscriberFiguresSchema,
  previous: AgencySubscriberFiguresSchema,
  /** Every day of the period, in order: active subscribers at its end, null when not read for every account. */
  days: z.array(z.strictObject({ day, active: later })),
  /** When the platform was last read for the accounts counted. */
  readAt: z.iso.datetime(),
});
export type AgencySubscribers = z.infer<typeof AgencySubscribersSchema>;

export const AgencyInsightsSchema = z.strictObject({
  period: AgencyPeriodSchema,
  from: day,
  to: day,
  previousFrom: day,
  previousTo: day,
  /** The creators counted, in the agency's order: those with an account linked to a register, within the scope. */
  creators: z.array(z.strictObject({ creatorId: CreatorIdSchema, name: z.string().min(1) })),
  totals: z.strictObject({ current: AgencyFiguresSchema, previous: AgencyFiguresSchema }),
  /** Every day of the period, in order, its revenue by creator and by kind (only those not zero). */
  days: z.array(
    z.strictObject({
      day,
      revenueMinor: cents,
      byCreator: z.array(z.strictObject({ creatorId: CreatorIdSchema, revenueMinor: cents })),
      byKind: z.array(z.strictObject({ kind: AgencySaleKindSchema, revenueMinor: cents })),
    }),
  ),
  /** By kind of sale, in the fixed order; a kind with nothing in either period is left out. */
  kinds: z.array(
    z.strictObject({
      kind: AgencySaleKindSchema,
      revenueMinor: cents,
      sales: count,
      previousRevenueMinor: cents,
    }),
  ),
  /** Who sold, the largest revenue first; a seller with nothing in the period is left out. */
  sellers: z.array(
    AgencyFiguresSchema.extend({ seller: DashboardSalesSellerSchema, previousRevenueMinor: cents }).strict(),
  ),
  /** Each creator counted, the largest revenue first. */
  byCreator: z.array(
    AgencyFiguresSchema.extend({ creatorId: CreatorIdSchema, previousRevenueMinor: cents }).strict(),
  ),
  /**
   * The period's sales (refunds aside) by day of the week (Monday first) and hour, in the platform's zone: 7 rows of
   * 24 sums in cents.
   */
  hours: z.array(z.array(cents).length(24)).length(7),
  /**
   * For a period of one day, its 24 hours in order, their sales (refunds aside) by creator and by kind (only those not
   * zero); empty for a longer period.
   */
  hourly: z.array(
    z.strictObject({
      hour: z.number().int().min(0).max(23),
      revenueMinor: cents,
      byCreator: z.array(z.strictObject({ creatorId: CreatorIdSchema, revenueMinor: cents })),
      byKind: z.array(z.strictObject({ kind: AgencySaleKindSchema, revenueMinor: cents })),
    }),
  ),
  /**
   * What fans spent: a fan's sales of the period less their refunds (whenever refunded, as the register takes a refund
   * off its sale), once per creator's account. Without a USD rate, a fan who paid in dollars alone is in no figure, in
   * the period as in the one before.
   */
  fans: z.strictObject({
    /** Fans who spent more than their refunds took back, in the period. */
    paying: count,
    previousPaying: count,
    /** Of them, those whose first purchase in the register falls in the period. */
    newPaying: count,
    /** Share of what fans spent made by the ten who spent the most, in % rounded; null without a paying fan. */
    topTenShare: z.number().int().min(0).max(100).nullable(),
    /** What a paying fan spent on average, in cents; null without one. */
    averagePerPayingMinor: cents.nullable(),
  }),
  /** Refunds of the period whose sale is older than the register: counted in no figure (CRM-02's note). */
  refundsWithoutSale: count,
  /** The zone of the platform's days and hours (IANA), the one every day and hour here is read in. */
  timeZone: z.string().min(1),
  /** A dollar line falls in the period and no rate is known: left out of every figure. */
  dollarsLeftOut: z.boolean(),
  /**
   * Subscribers, PPV and messages from the daily snapshot of the platform's statistics (ADR 0081), never money; null
   * while the snapshot holds nothing for the creators counted.
   */
  subscribers: AgencySubscribersSchema.nullable(),
});
export type AgencyInsights = z.infer<typeof AgencyInsightsSchema>;
