import { z } from 'zod';

/*
 * The trophy case: what an account has earned and what is still ahead of it, in one shape for the chatter's game
 * (ADR 0104), the creator's badges (ADR 0107) and the showcase that draws them (ADR 0108). The server says the
 * facts; the name of an object and how to earn it are screen text, keyed by `kind`.
 */

/** What draws the object: a tier's coin, a streak's flame, or a shield. */
export const TROPHY_CASE_FAMILIES = ['medal', 'streak', 'trophy'] as const;
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

export const TrophyCaseSchema = z.object({
  items: z.array(TrophyCaseItemSchema),
  streaks: z.array(TrophyCaseStreakSchema),
  level: TrophyCaseLevelSchema.nullable(),
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
