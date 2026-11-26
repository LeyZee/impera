import { z } from 'zod';

import { AvailabilityWeekIdSchema, TeamMemberIdSchema } from './ids';
import { TimezoneSchema } from './persona';

/** A member's weekly availability (ADR 0171, trou 16): plages of the week, in his own time zone, a week set whole. */

/** The most plages a week holds (ADR 0171 § 1). */
export const AVAILABILITY_RANGES_MAX = 21;

/** The step of a plage, in minutes: a quarter of an hour. */
export const AVAILABILITY_STEP_MINUTES = 15;

/** After how many days « Mes dispos » reminds the member to look at them again (§ 6). */
export const AVAILABILITY_STALE_DAYS = 30;

const minute = z
  .number()
  .int()
  .min(0)
  .max(24 * 60)
  .refine((value) => value % AVAILABILITY_STEP_MINUTES === 0, 'au quart d’heure');

/**
 * One plage: a day of the week (1 Monday … 7 Sunday, ISO), from `startMinute` to `endMinute` of that day in the member's
 * time zone. One that passes midnight is two plages, one each day.
 */
export const AvailabilityRangeSchema = z
  .strictObject({ weekday: z.number().int().min(1).max(7), startMinute: minute, endMinute: minute })
  .refine((range) => range.endMinute > range.startMinute, 'la fin vient après le début');
export type AvailabilityRange = z.infer<typeof AvailabilityRangeSchema>;

/** A week's plages, in order, none overlapping another of its day. */
export const AvailabilityRangesSchema = z
  .array(AvailabilityRangeSchema)
  .max(AVAILABILITY_RANGES_MAX)
  .refine(
    (ranges) =>
      ranges.every((range, index) =>
        ranges.every(
          (other, at) =>
            at === index ||
            other.weekday !== range.weekday ||
            other.endMinute <= range.startMinute ||
            other.startMinute >= range.endMinute,
        ),
      ),
    'deux plages du même jour se chevauchent',
  );

/**
 * A member's week in force: his plages, the time zone they were given in, when and by whom (himself, or the owner or a
 * manager for him). `setAt` is `null` while he gave none: he then shows on no place.
 */
export const MemberAvailabilitySchema = z.object({
  memberId: TeamMemberIdSchema,
  weekId: AvailabilityWeekIdSchema.nullable(),
  timeZone: TimezoneSchema,
  ranges: z.array(AvailabilityRangeSchema),
  setAt: z.iso.datetime().nullable(),
  setByMember: z.boolean(),
});
export type MemberAvailability = z.infer<typeof MemberAvailabilitySchema>;

/** `GET /v1/scheduling/availability` (the owner and an active manager): every active member's week in force. */
export const TeamAvailabilitySchema = z.object({ members: z.array(MemberAvailabilitySchema) });
export type TeamAvailability = z.infer<typeof TeamAvailabilitySchema>;

/**
 * `PUT /v1/scheduling/availability/mine` and `PUT /v1/scheduling/availability/:memberId` (the owner and an active
 * manager, for a member): the whole week, which replaces the one in force from now on. `id` makes it idempotent.
 */
export const SetAvailabilityBodySchema = z.strictObject({
  id: AvailabilityWeekIdSchema,
  ranges: AvailabilityRangesSchema,
});
export type SetAvailabilityBody = z.infer<typeof SetAvailabilityBodySchema>;

export const AvailabilityMemberParamsSchema = z.object({ memberId: TeamMemberIdSchema });
