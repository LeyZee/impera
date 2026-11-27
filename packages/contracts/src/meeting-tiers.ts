import { z } from 'zod';

/** The highest meeting tier a fan can reach (1 brand new … 5 very close): `relationshipTier`. */
export const MEETING_TIER_MAX = 5;

/**
 * The reasons she gives him for not meeting yet, in the order of the relationship: each tier allows its own and every
 * one below it (`meetingAnswer`). Journaled by `meeting_answered`, so that she never gives one twice to the same fan.
 */
export const MEETING_REASONS = ['too_early', 'needs_time', 'secret', 'no_dates', 'safety'] as const;
export const MeetingReasonSchema = z.enum(MEETING_REASONS);
export type MeetingReason = z.infer<typeof MeetingReasonSchema>;

/**
 * @public When a fan asking to see her moves up a tier (guide 26/11): per creator, typed by the owner in Créatrices ›
 * Compte, stored in `creators.settings.meetingTiers` (same pattern as ADR 0135 § 1), never a value in the repo. Read
 * by `conversations` with the fan's figures and given to every compose path (answer, follow-up, word after a sale).
 * Absent, no fan goes past the second tier, as a fan who never paid. The three durations rise.
 */
export const MeetingTierSettingsSchema = z
  .strictObject({
    /** Known at least this many hours: no longer brand new. */
    newFanHours: z.number().positive(),
    /** A payer known at least this many hours: close. */
    closeFanHours: z.number().positive(),
    /** A payer known at least this many hours: very close. */
    veryCloseFanHours: z.number().positive(),
  })
  .refine((t) => t.newFanHours < t.closeFanHours && t.closeFanHours < t.veryCloseFanHours, {
    message: 'Les durées montent',
  });
export type MeetingTierSettings = z.infer<typeof MeetingTierSettingsSchema>;

/**
 * `GET` and `PUT /v1/creators/:id/meeting-tiers` (the owner's alone): her three durations, or `null` when none is set
 * (then removed from her settings).
 */
export const MeetingTiersBodySchema = z.strictObject({ settings: MeetingTierSettingsSchema.nullable() });
export type MeetingTiersBody = z.infer<typeof MeetingTiersBodySchema>;
