import { z } from 'zod';

import { CurrencySchema } from './money';

/*
 * The trophy case: what an account has earned and what is still ahead of it, in one shape for the chatter's game
 * (ADR 0104), the creator's badges (ADR 0107) and the showcase that draws them (ADR 0108). The server says the
 * facts; the name of an object and how to earn it are screen text, keyed by `kind`.
 */

/** What draws the object: a tier's coin, a streak's flame, a shield, or a rank's insignia. */
export const TROPHY_CASE_FAMILIES = ['medal', 'streak', 'trophy', 'level'] as const;
export const TrophyCaseFamilySchema = z.enum(TROPHY_CASE_FAMILIES);
export type TrophyCaseFamily = z.infer<typeof TrophyCaseFamilySchema>;

/** What a progress counts in. `cents` is an amount read on a statement, never worked out by the game. */
export const TROPHY_CASE_UNITS = ['shift', 'day', 'delivery', 'category', 'cents'] as const;
export const TrophyCaseUnitSchema = z.enum(TROPHY_CASE_UNITS);

export const TrophyCaseProgressSchema = z.object({
  current: z.number().int().nonnegative(),
  target: z.number().int().positive(),
  unit: TrophyCaseUnitSchema,
});
export type TrophyCaseProgress = z.infer<typeof TrophyCaseProgressSchema>;

export const TrophyCaseItemSchema = z.object({
  /** The object, from the closed list of the module that gives it. */
  kind: z.string().min(1).max(64),
  family: TrophyCaseFamilySchema,
  /** When it was earned; `null` while it is still ahead. */
  earnedAt: z.iso.datetime().nullable(),
  /** How far along, for the objects that have a count; `null` for the others. */
  progress: TrophyCaseProgressSchema.nullable(),
  /** When its reveal was played; `null` on an earned object means the reveal is still owed. */
  revealedAt: z.iso.datetime().nullable(),
});
export type TrophyCaseItem = z.infer<typeof TrophyCaseItemSchema>;

export const TROPHY_CASE_STREAK_KINDS = ['shift', 'day', 'delivery'] as const;

export const TrophyCaseStreakSchema = z.object({
  kind: z.enum(TROPHY_CASE_STREAK_KINDS),
  current: z.number().int().nonnegative(),
  best: z.number().int().nonnegative(),
});
export type TrophyCaseStreak = z.infer<typeof TrophyCaseStreakSchema>;

/** An honorary rank: no rate, tier or right hangs on it. */
export const TrophyCaseLevelSchema = z.object({
  rank: z.number().int().positive(),
  name: z.string().min(1).max(40),
});
export type TrophyCaseLevel = z.infer<typeof TrophyCaseLevelSchema>;

/**
 * The rank ahead and how far the account's own cumulated net is from it. Said to the account itself only: a read of
 * someone else's case leaves it `null`.
 */
export const TrophyCaseNextLevelSchema = TrophyCaseLevelSchema.extend({
  thresholdMinor: z.number().int().positive(),
  currentMinor: z.number().int().nonnegative(),
  currency: CurrencySchema,
});
export type TrophyCaseNextLevel = z.infer<typeof TrophyCaseNextLevelSchema>;

export const TrophyCaseSchema = z.object({
  items: z.array(TrophyCaseItemSchema),
  streaks: z.array(TrophyCaseStreakSchema),
  level: TrophyCaseLevelSchema.nullable(),
  /** Left out by a module that has no levels (the creator's badges) and by a read of someone else's case. */
  nextLevel: TrophyCaseNextLevelSchema.nullable().optional(),
});
export type TrophyCase = z.infer<typeof TrophyCaseSchema>;

/** The objects earned whose reveal has not been played yet, oldest first. */
export const owedReveals = (trophyCase: TrophyCase): TrophyCaseItem[] =>
  trophyCase.items
    .filter((item) => item.earnedAt !== null && item.revealedAt === null)
    .toSorted((a, b) => (a.earnedAt ?? '').localeCompare(b.earnedAt ?? ''));

/** `POST /v1/rewards/my-trophy-case/reveals`: the objects whose reveal the account has just seen, by `kind`. */
export const MarkRevealedBodySchema = z.strictObject({
  kinds: z.array(TrophyCaseItemSchema.shape.kind).min(1).max(32),
});
export type MarkRevealedBody = z.infer<typeof MarkRevealedBodySchema>;

/*
 * The shift's challenge (ADR 0104 § 14): the session's own net on the shift shown against the median of its own
 * comparable shifts. `null` when there is no shift to show or too little history. It never reaches pay (§ 17).
 */
export const ShiftChallengeSchema = z.object({
  shiftStartsAt: z.iso.datetime(),
  shiftEndsAt: z.iso.datetime(),
  currency: CurrencySchema,
  targetMinor: z.number().int().positive(),
  netMinor: z.number().int(),
  met: z.boolean(),
});
export type ShiftChallenge = z.infer<typeof ShiftChallengeSchema>;

/** `GET /v1/rewards/my-shift-challenge`. */
export const MyShiftChallengeSchema = z.object({ challenge: ShiftChallengeSchema.nullable() });
export type MyShiftChallenge = z.infer<typeof MyShiftChallengeSchema>;

/** How many ranks the game has: a closed list, named and drawn by the code (ADR 0104 § 16). */
export const LEVEL_RANKS = 8;
/** The highest threshold a rank may ask, in minor units. */
const LEVEL_THRESHOLD_MAX_MINOR = 1_000_000_000;

/**
 * The owner's setting (§ 16): the cumulated net that opens each rank, the first rank first, each above the one
 * before. Fewer thresholds than ranks leaves the ranks above closed; none means no level at all.
 */
export const LevelThresholdsSchema = z.strictObject({
  thresholdsMinor: z
    .array(z.number().int().min(1).max(LEVEL_THRESHOLD_MAX_MINOR))
    .max(LEVEL_RANKS)
    .refine(
      (values) => values.every((value, index) => index === 0 || value > (values[index - 1] ?? 0)),
      'Chaque seuil doit dépasser le précédent',
    ),
});
export type LevelThresholds = z.infer<typeof LevelThresholdsSchema>;

/** `GET /v1/rewards/level-thresholds`: the ranks by name, and the thresholds set. */
export const LevelSettingsSchema = z.object({
  ranks: z.array(TrophyCaseLevelSchema),
  thresholdsMinor: LevelThresholdsSchema.shape.thresholdsMinor,
});
export type LevelSettings = z.infer<typeof LevelSettingsSchema>;
