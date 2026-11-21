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

/**
 * The calendar's ways of choosing the days (ADR 0146 § 1): a day, a week from Monday to Sunday, a calendar month, or
 * the days chosen. `rolling` is the older `period`'s answer (ADR 0078 § 3), kept for the MCP and shared links.
 */
export const AgencyUnitSchema = z.enum(['day', 'week', 'month', 'custom']);
export type AgencyUnit = z.infer<typeof AgencyUnitSchema>;

/** The longest span the screen reads, days both included (ADR 0146 § 1). */
export const AGENCY_CUSTOM_MAX_DAYS = 366;

const isoDay = z.iso.date();

/** The days asked, in one form or the other (ADR 0146 § 6); the server fixes them in the platform's zone. */
export type AgencySpanQuery =
  | { readonly kind: 'rolling'; readonly period: AgencyPeriod }
  | {
      readonly kind: 'calendar';
      readonly unit: Exclude<AgencyUnit, 'custom'>;
      /** A day of the period wanted; absent, today. */
      readonly at?: string | undefined;
      /** A day of the period to compare with; absent, the period just before. */
      readonly compareAt?: string | undefined;
    }
  | {
      readonly kind: 'custom';
      readonly from: string;
      readonly to: string;
      /** The first day of the span to compare with, as long; absent, the span just before. */
      readonly compareAt?: string | undefined;
    };

const dayCount = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

export const AgencyInsightsQuerySchema = z
  .object({
    /** The older form: days counted back from today (ADR 0078 § 3). */
    period: AgencyPeriodSchema.optional(),
    /** The calendar's form (ADR 0146 § 6). */
    unit: AgencyUnitSchema.optional(),
    at: isoDay.optional(),
    from: isoDay.optional(),
    to: isoDay.optional(),
    compareAt: isoDay.optional(),
    /** One creator alone; absent, every creator the account reads with the team's scope. */
    creatorId: CreatorIdSchema.optional(),
  })
  .superRefine((query, ctx) => {
    if (query.period !== undefined && query.unit !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'period ou unit, pas les deux', path: ['unit'] });
    }
    if (query.unit === 'custom') {
      if (query.from === undefined || query.to === undefined) {
        ctx.addIssue({ code: 'custom', message: 'from et to sont requis', path: ['from'] });
      } else if (query.from > query.to) {
        ctx.addIssue({ code: 'custom', message: 'from après to', path: ['from'] });
      } else if (dayCount(query.from, query.to) > AGENCY_CUSTOM_MAX_DAYS) {
        ctx.addIssue({ code: 'custom', message: 'au plus 366 jours', path: ['to'] });
      }
    }
  });
export type AgencyInsightsQuery = z.infer<typeof AgencyInsightsQuerySchema>;

/** The query's days in one form (ADR 0146 § 6): neither form given is the older default, seven days. */
export function agencySpanQueryOf(query: AgencyInsightsQuery): AgencySpanQuery {
  if (query.unit === undefined) return { kind: 'rolling', period: query.period ?? 'week' };
  if (query.unit === 'custom') {
    return { kind: 'custom', from: query.from ?? '', to: query.to ?? '', compareAt: query.compareAt };
  }
  return { kind: 'calendar', unit: query.unit, at: query.at, compareAt: query.compareAt };
}

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

/**
 * The VAT rate the platform adds to the agency's transfers, on its part, in basis points (ADR 0106 § 7): France's
 * standard rate. A rule of the code, read by the server's estimate and by the screen that says it.
 */
export const AGENCY_TRANSFER_VAT_BPS = 2_000;

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

/** How the days were chosen (ADR 0146): the screen says them with it. */
export const AgencySpanSchema = z.strictObject({
  unit: z.enum(['day', 'week', 'month', 'custom', 'rolling']),
  /** The week or month asked runs past today: read up to today, the comparison cut at as many days (§ 2). */
  partial: z.boolean(),
  /** The period's own last day before the cut (the 30th of a month read up to the 16th). */
  end: day,
  /** The comparison is the period just before, or one chosen (§ 3). */
  compare: z.enum(['previous', 'chosen']),
  /** Today, in the platform's zone: the screen never reads a day after it. */
  today: day,
});
export type AgencySpan = z.infer<typeof AgencySpanSchema>;

/**
 * The month's revenue objectives (ADR 0092 § 6), on a calendar month read: each creator counted with the owner's
 * objective (null when none is set), her revenue so far and its linear projection to the month's end; the agency's
 * objective is the sum of those set. Internal: never her account's, never the MCP's.
 */
export const AgencyObjectivesSchema = z.strictObject({
  /** The month's first day. */
  month: day,
  /** Days of the month gone, today counted, out of its days: equal once the month is over. */
  daysGone: z.number().int().positive(),
  days: z.number().int().positive(),
  creators: z.array(
    z.strictObject({
      creatorId: CreatorIdSchema,
      objectiveMinor: count.nullable(),
      revenueMinor: cents,
      /** At this pace to the month's end; null once the month is over (the revenue is final). */
      projectedMinor: cents.nullable(),
    }),
  ),
  /** The sum of the objectives set; null when none is. */
  objectiveMinor: count.nullable(),
  revenueMinor: cents,
  projectedMinor: cents.nullable(),
});
export type AgencyObjectives = z.infer<typeof AgencyObjectivesSchema>;

/** The largest objective the owner may set for a creator's month, in euro cents: a typo of zeros stops here. */
export const AGENCY_OBJECTIVE_MAX_MINOR = 100_000_000;

/** `PUT /v1/dashboard/agency/objectives/:creatorId/:month` and its `DELETE`: the owner's alone (ADR 0092 § 6). */
export const AgencyObjectiveParamsSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  month: day.refine((value) => value.endsWith('-01'), { message: 'Le premier jour du mois' }),
});
export const AgencyObjectiveBodySchema = z.strictObject({
  amountMinor: z.number().int().positive().max(AGENCY_OBJECTIVE_MAX_MINOR),
});
export const AgencyObjectiveSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  month: day,
  amountMinor: count,
});
export type AgencyObjective = z.infer<typeof AgencyObjectiveSchema>;

export const AgencyInsightsSchema = z.strictObject({
  /** The older form's period; null for a calendar's (ADR 0146 § 6). */
  period: AgencyPeriodSchema.nullable(),
  span: AgencySpanSchema,
  from: day,
  to: day,
  previousFrom: day,
  previousTo: day,
  /**
   * The first day of the registers counted, their oldest line, in the platform's zone; null without a line. A
   * comparison that starts before it is not compared (ADR 0146 § 4).
   */
  registerSince: day.nullable(),
  /** The creators counted, in the agency's order: those with an account linked to a register, within the scope. */
  creators: z.array(z.strictObject({ creatorId: CreatorIdSchema, name: z.string().min(1) })),
  totals: z.strictObject({ current: AgencyFiguresSchema, previous: AgencyFiguresSchema }),
  /**
   * Every day of the period, in order, its revenue by creator and by kind (only those not zero), and its two parts of
   * the net (the tiles' small curves): read by whoever reads the totals' parts, never by the MCP (ADR 0144). A refund
   * stays on its sale's day; each day is rounded on its own, as its revenue, so the days add up to the period's parts
   * to the cent in euros and within a cent per day with dollars.
   */
  days: z.array(
    z.strictObject({
      day,
      revenueMinor: cents,
      agencyMinor: cents,
      creatorMinor: cents,
      byCreator: z.array(z.strictObject({ creatorId: CreatorIdSchema, revenueMinor: cents })),
      byKind: z.array(z.strictObject({ kind: AgencySaleKindSchema, revenueMinor: cents })),
    }),
  ),
  /** Every day of the comparison, in order, its revenue: the curve's discreet line (ADR 0146 § 5). */
  previousDays: z.array(z.strictObject({ day, revenueMinor: cents })),
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
  /**
   * The period's refunds one by one, the latest first (ADR 0092 § 4): those the totals take off (on their sale's day)
   * and those whose sale is older than the register (on their own day, `delayDays` null). Read by whoever reads the
   * sellers, never by the MCP (ADR 0144): it names the chatter of each sale. Never a fan.
   */
  refundList: z.array(
    z.strictObject({
      /** When the fan was refunded. */
      refundedAt: z.iso.datetime(),
      creatorId: CreatorIdSchema,
      kind: AgencySaleKindSchema,
      /** What the fan got back, VAT included, in euro cents; null for dollars while no rate is known. */
      amountMinor: count.nullable(),
      /** Who sold the sale refunded, as « Qui a vendu » says it. */
      seller: DashboardSalesSellerSchema,
      /** Whole days from the sale to its refund; null when the sale is not in the register. */
      delayDays: count.nullable(),
    }),
  ),
  /** Refunds of the period whose sale is older than the register: counted in no figure (CRM-02's note). */
  refundsWithoutSale: count,
  /** On a calendar month, its revenue objectives (ADR 0092 § 6); null for any other period. */
  objectives: AgencyObjectivesSchema.nullable(),
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
