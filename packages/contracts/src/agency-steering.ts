import { z } from 'zod';

import { CreatorIdSchema } from './ids';

/**
 * `GET /v1/dashboard/agency/steering` (ADR 0092, avenant du 21/11/2026): what the owner and an active manager steer the
 * agency with, on fixed windows whatever period the rest of the Dashboard reads. Money in integer euro cents, gross
 * incl. VAT less the refunds of its sales (the register's « chiffre d'affaires », dollars at pay's last ECB rate, left
 * out without one), each day the platform's. The lapsed payers are named for the agency (ADR 0092 § 3).
 */

/** The days of the rolling window, today included. */
export const STEERING_WINDOW_DAYS = 30;
/** A payer who has bought nothing for this many days is « lapsed » (ADR 0092 § 3, N by default). */
export const STEERING_LAPSED_DAYS = 21;
/** At most this many lapsed payers are listed, the biggest spenders first. */
export const STEERING_LAPSED_MAX = 8;
/** Days of history the hourly profile of the day's projection needs before one is drawn. */
export const STEERING_PROFILE_MIN_DAYS = 7;
/** Sales the hourly profile needs before a projection is drawn (ADR 0092 § 5's threshold). */
export const STEERING_PROFILE_MIN_SALES = 30;

export const SteeringQuerySchema = z.strictObject({
  creatorId: CreatorIdSchema.optional(),
});
export type SteeringQuery = z.infer<typeof SteeringQuerySchema>;

const isoDay = z.iso.date();
const minor = z.number().int();
const count = z.number().int().nonnegative();

/** The day's objective: the month's objectives divided by its days, today's revenue and where it should end. */
export const SteeringDailySchema = z.strictObject({
  /** The month's objectives (ADR 0092 § 6) over its days; null while no objective is set this month. */
  targetMinor: minor.nullable(),
  todayMinor: minor,
  /** Today's revenue over the share the past days had made by this hour; null on too little history. */
  projectedMinor: minor.nullable(),
  /** The last window's days, today last: each one's revenue. */
  days: z.array(z.strictObject({ day: isoDay, revenueMinor: minor })),
  /** The average of the seven days before today. */
  averageMinor: minor,
});
export type SteeringDaily = z.infer<typeof SteeringDailySchema>;

/**
 * From traffic to money, over the window: new subscribers (the platform's statistics, null while unread), fans whose
 * first message arrived (null when Impera reads no conversation of the creators counted), fans who bought for the first
 * time, and those of them who bought at least twice (« payeurs réguliers »).
 */
export const SteeringTrafficSchema = z.strictObject({
  newSubscribers: count.nullable(),
  wrote: count.nullable(),
  firstPurchase: count,
  regular: count,
  /** The same counts over the window before, for the deltas. */
  previous: z.strictObject({
    newSubscribers: count.nullable(),
    wrote: count.nullable(),
    firstPurchase: count,
    regular: count,
  }),
});
export type SteeringTraffic = z.infer<typeof SteeringTrafficSchema>;

/** One payer who stopped buying (ADR 0092 § 3): named, never a message. */
export const SteeringLapsedSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  fanName: z.string(),
  /** Everything he spent in the register, less its refunds. */
  spentMinor: minor,
  lastPurchaseDay: isoDay,
  daysSince: count,
  /** His conversation in Suivi, when Impera reads it. */
  conversationId: z.uuid().nullable(),
});
export type SteeringLapsed = z.infer<typeof SteeringLapsedSchema>;

/** How much the window's revenue hangs on a few fans. */
export const SteeringDependencySchema = z.strictObject({
  payingFans: count,
  /** The window's sales: a conclusion waits for enough of them (ADR 0092 § 5). */
  sales: count,
  totalMinor: minor,
  /** The biggest fan, the four after him, everyone else: the donut's slices. */
  topOneMinor: minor,
  nextFourMinor: minor,
  restMinor: minor,
  /** The fewest fans who make 80 % of the revenue. */
  fansForEighty: count,
  /** The middle paying fan's spend: a whale does not move it. */
  medianMinor: minor.nullable(),
  lapsed: z.array(SteeringLapsedSchema),
});
export type SteeringDependency = z.infer<typeof SteeringDependencySchema>;

export const AgencySteeringSchema = z.strictObject({
  today: isoDay,
  timeZone: z.string(),
  /** The creators counted, in the agency's order. */
  creators: z.array(z.strictObject({ creatorId: CreatorIdSchema, name: z.string() })),
  /** The oldest day of the registers counted; null without any sale. */
  registerSince: isoDay.nullable(),
  /** Some sale paid in dollars counts in no figure, for want of a rate. */
  dollarsLeftOut: z.boolean(),
  daily: SteeringDailySchema,
  traffic: SteeringTrafficSchema,
  dependency: SteeringDependencySchema,
});
export type AgencySteering = z.infer<typeof AgencySteeringSchema>;
