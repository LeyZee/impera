/*
 * The levels (ADR 0104 § 16): a rank that follows the member's net since they joined, and comes down only when that
 * net is corrected under the threshold it was reached at (ADR 0118 § 5), never because the thresholds moved (§ 7).
 * Honorary only: no rate, tier or right hangs on it. The ranks are a closed list named here; the cumulated net that
 * opens each one is the owner's setting, and with none set there is no level.
 */

/** The ranks, the first first. Their names are the game's own words, shown as they are. */
export const LEVEL_NAMES = [
  'Étincelle',
  'Allumeur',
  'Charmeur',
  'Séducteur',
  'Envoûteur',
  'Tentateur',
  'Brasier',
  'Incendiaire',
] as const;

export interface LevelStep {
  readonly rank: number;
  readonly name: string;
  readonly thresholdMinor: number;
}

/** The ranks the owner's thresholds open, the first first: a rank with no threshold stays closed. */
export function levelSteps(thresholdsMinor: readonly number[]): LevelStep[] {
  return LEVEL_NAMES.flatMap((name, index) => {
    const thresholdMinor = thresholdsMinor[index];
    return thresholdMinor === undefined ? [] : [{ rank: index + 1, name, thresholdMinor }];
  });
}

/** The ranks a cumulated net reaches today, each with the threshold that opens it. */
export const ranksReached = (cumulatedNetMinor: number, steps: readonly LevelStep[]): LevelStep[] =>
  steps.filter((step) => step.thresholdMinor <= cumulatedNetMinor);

/** A rank by its number, or `null` when the list has none there. */
export function levelOfRank(rank: number): { readonly rank: number; readonly name: string } | null {
  const name = LEVEL_NAMES[rank - 1];
  return name === undefined ? null : { rank, name };
}

/** The first rank above `rank` that has a threshold, or `null` at the top or with none set above. */
export const nextStep = (rank: number, steps: readonly LevelStep[]): LevelStep | null =>
  steps.find((step) => step.rank > rank) ?? null;
