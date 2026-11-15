import { z } from 'zod';

import { PlatformSchema } from './enums';
import { CreatorAgencyRateIdSchema, CreatorIdSchema, PlatformAccountIdSchema } from './ids';
import { CurrencySchema } from './money';
import { BasisPointsSchema } from './team';
import { CalendarDaySchema } from './team-members';

/**
 * The agency's percentage of each creator (ADR 0042 § 6, CR-04), under `/v1/creators/:creatorId/agency-rates`: what
 * the agency takes of her net, set by the owner, from a day on, never backwards. No value is ever made up: a creator
 * without one has no agency share shown (« à régler »), and on Reveal it only feeds the owner's gap signal, her part
 * being Reveal's own figure (ADR 0054 § 2). There it is optional: the agency's share is read on the register instead
 * (ADR 0054 § 4 to § 7).
 */

/**
 * A creator's percentage from `fromDay` on, until her next one. `fromDay` is a calendar day in the agency's zone, the
 * zone of the pay periods: a sale takes the percentage in force on its day there. `agencyBps` is in whole basis points
 * (3500 = 35 %): no float in money (ADR 0011). Added only: never changed nor deleted, and one per creator and day at
 * most (a unique constraint).
 */
export const CreatorAgencyRateSchema = z.object({
  id: CreatorAgencyRateIdSchema,
  creatorId: CreatorIdSchema,
  fromDay: CalendarDaySchema,
  agencyBps: BasisPointsSchema,
  createdAt: z.iso.datetime(),
});
export type CreatorAgencyRate = z.infer<typeof CreatorAgencyRateSchema>;

/** The percentage in force on `day`: the one with the latest `fromDay` at or before it, or `null` before the first. */
export function agencyRateFor<R extends { readonly fromDay: string }>(
  rates: readonly R[],
  day: string,
): R | null {
  let found: R | null = null;
  for (const one of rates) {
    if (one.fromDay <= day && (found === null || one.fromDay > found.fromDay)) found = one;
  }
  return found;
}

/**
 * The agency's share of one account in one currency as the platform reads it (ADR 0054 § 4): the sums of the net and
 * of the agency's part of its sales over a window, refunds taken off, the platform's own figures never computed again,
 * and their ratio in basis points rounded to the nearest (`null` without a net to divide by).
 */
export const ObservedAgencyShareSchema = z.object({
  platform: PlatformSchema,
  platformAccountId: PlatformAccountIdSchema,
  currency: CurrencySchema,
  netMinor: z.number().int(),
  agencyMinor: z.number().int(),
  agencyBps: z.number().int().nullable(),
});
export type ObservedAgencyShare = z.infer<typeof ObservedAgencyShareSchema>;

/** One window of days, both included, and the shares read on it; an account without a sale in it is left out. */
export const ObservedAgencyWindowSchema = z.object({
  from: CalendarDaySchema,
  to: CalendarDaySchema,
  shares: z.array(ObservedAgencyShareSchema),
});
export type ObservedAgencyWindow = z.infer<typeof ObservedAgencyWindowSchema>;

/**
 * `GET /v1/creators/:creatorId/agency-rates` (owner only): her percentages newest first, the day it is now in the
 * agency's zone, and the one in force that day (`null` while none is: « à régler »). `observed` is the agency's share
 * read on the register (ADR 0054 § 4): the last 30 days to today, and the fortnight in course with the two before it,
 * newest first. `linked`: one of her accounts is linked to a platform's sales feed, so her share is read there even
 * on days without a sale. The screen picks nothing itself.
 */
export const CreatorAgencyRateListSchema = z.object({
  today: CalendarDaySchema,
  current: CreatorAgencyRateSchema.nullable(),
  rates: z.array(CreatorAgencyRateSchema),
  observed: z.object({
    linked: z.boolean(),
    last30Days: ObservedAgencyWindowSchema,
    fortnights: z.array(ObservedAgencyWindowSchema),
  }),
});
export type CreatorAgencyRateList = z.infer<typeof CreatorAgencyRateListSchema>;

/**
 * `POST /v1/creators/:creatorId/agency-rates` (owner only, the database refuses anyone else) → 201
 * `CreatorAgencyRateSchema`, or 200 when the same `id` was already recorded with the same values
 * (`agency_rate_conflict` otherwise). `id` is made by the client when the form opens, so a retry records one
 * percentage. A percentage starts tomorrow at the earliest, in the agency's zone, so that no sale already made changes
 * share; her first alone may start today, since nothing was shown as the agency's share before it
 * (`agency_rate_day_invalid` otherwise). A second one for the same day answers `agency_rate_day_conflict` with
 * `details.creatorAgencyRateId`: the screen has the owner confirm before sending, and a mistake is put right by the
 * next percentage.
 */
export const CreateCreatorAgencyRateBodySchema = z.object({
  id: CreatorAgencyRateIdSchema,
  fromDay: CalendarDaySchema,
  agencyBps: BasisPointsSchema,
});
export type CreateCreatorAgencyRateBody = z.input<typeof CreateCreatorAgencyRateBodySchema>;

/**
 * The error codes of `/v1/creators/:creatorId/agency-rates`, for the screen to say them in French (the suffix gives
 * the status, api.md): `creator_not_found` 404 ; `agency_rate_conflict` 409, the same `id` with other values ;
 * `agency_rate_day_conflict` 409, she already has a percentage from that day (`details.creatorAgencyRateId`) ;
 * `agency_rate_day_invalid` 400, a day that has begun, other than today for her first percentage.
 */
export const AGENCY_RATE_ERROR_CODES = [
  'creator_not_found',
  'agency_rate_conflict',
  'agency_rate_day_conflict',
  'agency_rate_day_invalid',
] as const;
export type AgencyRateErrorCode = (typeof AGENCY_RATE_ERROR_CODES)[number];
