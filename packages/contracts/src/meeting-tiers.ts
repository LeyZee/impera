import { z } from 'zod';

/** The highest meeting tier a fan can reach (1 brand new … 5 very close): `relationshipTier`. */
export const MEETING_TIER_MAX = 5;

/**
 * @public When a fan asking to see her moves up a tier (guide 26/11): per creator, typed by the owner, never a value
 * in the repo (same pattern as ADR 0135 § 1). Storing and wiring these settings is the next batch: nothing reads them
 * in production yet. Without them, no fan goes past the second tier, as a fan who never paid.
 */
export const MeetingTierSettingsSchema = z.strictObject({
  /** Known at least this many hours: no longer brand new. */
  newFanHours: z.number().positive(),
  /** A payer known at least this many hours: close. */
  closeFanHours: z.number().positive(),
  /** A payer known at least this many hours: very close. */
  veryCloseFanHours: z.number().positive(),
});
export type MeetingTierSettings = z.infer<typeof MeetingTierSettingsSchema>;
