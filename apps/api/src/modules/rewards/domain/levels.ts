/*
 * The levels (ADR 0104 § 16): a rank that rises with the member's net since they joined and never comes down.
 * Honorary only: no rate, tier or right hangs on it. The thresholds are the owner's setting; with none set there
 * is no level.
 */

export interface LevelStep {
  readonly rank: number;
  readonly name: string;
  readonly thresholdMinor: number;
}

export interface Level {
  readonly rank: number;
  readonly name: string;
  /** The next step, or `null` at the top. */
  readonly next: LevelStep | null;
}

/**
 * The level a cumulated net gives. `highestNetMinor` is the highest the member's cumulated net ever was: a refund
 * lowers the net, never the level.
 */
export function levelOf(highestNetMinor: number, steps: readonly LevelStep[]): Level | null {
  const ordered = steps.toSorted((a, b) => a.thresholdMinor - b.thresholdMinor);
  const reached = ordered.findLast((step) => step.thresholdMinor <= highestNetMinor);
  if (reached === undefined) return null;
  return {
    rank: reached.rank,
    name: reached.name,
    next: ordered.find((step) => step.thresholdMinor > highestNetMinor) ?? null,
  };
}
