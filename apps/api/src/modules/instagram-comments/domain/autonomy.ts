import type { CommentRatingVerdict } from '@impera/contracts';

/**
 * When the answers may leave alone (ADR 0122 § 5): the code offers autonomy only once the training is enough, on
 * her active persona. The owner sets the two numbers, inside a floor and a ceiling the code fixes.
 */
export interface AutonomyThresholds {
  /** Ratings needed on the active persona. */
  readonly ratings: number;
  /** The last ones, all validated as they were. */
  readonly validatedStreak: number;
}

export const DEFAULT_AUTONOMY_THRESHOLDS: AutonomyThresholds = { ratings: 30, validatedStreak: 10 };

const RATINGS_FLOOR = 10;
const RATINGS_CEILING = 500;
const STREAK_FLOOR = 5;
const STREAK_CEILING = 100;

function clamp(value: number, floor: number, ceiling: number): number {
  return Math.min(ceiling, Math.max(floor, Math.trunc(value)));
}

/** The owner's setting brought back inside the code's bounds; the streak never exceeds the number of ratings. */
export function boundedThresholds(asked: AutonomyThresholds): AutonomyThresholds {
  const ratings = clamp(asked.ratings, RATINGS_FLOOR, RATINGS_CEILING);
  return {
    ratings,
    validatedStreak: Math.min(ratings, clamp(asked.validatedStreak, STREAK_FLOOR, STREAK_CEILING)),
  };
}

export interface AutonomyReadiness {
  readonly ready: boolean;
  readonly ratings: number;
  /** The validated ratings at the end of the list, without a miss between them. */
  readonly validatedStreak: number;
  readonly thresholds: AutonomyThresholds;
}

/**
 * `verdicts` are the ratings of her active persona's version, oldest first. Only « validated » is a success; a
 * « corrected » one is a miss, and breaks the streak like a refusal.
 */
export function autonomyReadiness(
  verdicts: readonly CommentRatingVerdict[],
  asked: AutonomyThresholds = DEFAULT_AUTONOMY_THRESHOLDS,
): AutonomyReadiness {
  const thresholds = boundedThresholds(asked);
  let validatedStreak = 0;
  for (let index = verdicts.length - 1; index >= 0 && verdicts[index] === 'validated'; index -= 1)
    validatedStreak += 1;
  return {
    ready: verdicts.length >= thresholds.ratings && validatedStreak >= thresholds.validatedStreak,
    ratings: verdicts.length,
    validatedStreak,
    thresholds,
  };
}

/** Two refusals of Meta's in a row switch autonomy off by themselves (§ 5). */
export function refusalsSwitchAutonomyOff(consecutiveRefusals: number): boolean {
  return consecutiveRefusals >= 2;
}
