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
  netMinor: cents,
  agencyMinor: cents,
  creatorMinor: cents,
  sales: count,
  refunds: count,
});
export type AgencyFigures = z.infer<typeof AgencyFiguresSchema>;

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
  fans: z.strictObject({
    /** Fans who paid in the period, once per creator's account. */
    paying: count,
    previousPaying: count,
    /** Of them, those whose first purchase in the register falls in the period. */
    newPaying: count,
    /** Share of the period's sales made by the ten fans who spent the most, in % rounded; null without a sale. */
    topTenShare: z.number().int().min(0).max(100).nullable(),
    /** What a paying fan spent on average, in cents; null without one. */
    averagePerPayingMinor: cents.nullable(),
  }),
  /** A dollar line falls in the period and no rate is known: left out of every figure. */
  dollarsLeftOut: z.boolean(),
});
export type AgencyInsights = z.infer<typeof AgencyInsightsSchema>;
