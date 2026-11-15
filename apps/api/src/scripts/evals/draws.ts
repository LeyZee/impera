import type { ScenarioResult } from './check';

/** How many times each scenario is drawn by default: one draw of a voice tuned to vary proves little (OPS-11). */
export const DEFAULT_DRAWS = 3;

/** One draw of a scenario: what its own checks found, and the judge's scores when her answer was judged. */
export interface Draw {
  readonly failures: readonly string[];
  readonly scores: Readonly<Record<string, number>>;
}

/**
 * The draws of one scenario as one result. It fails if any draw fails, each failure named with its draw. Its scores
 * are the mean of the draws that were scored. Its minima are checked against the worst draw: a criterion missing
 * from one draw is missing from the worst, because a draw nobody scored is not a pass.
 */
export function mergeDraws(file: string, draws: readonly Draw[]): ScenarioResult {
  const [first] = draws;
  if (first === undefined) return { file, failures: ['aucun tirage'], scores: {} };
  if (draws.length === 1) return { file, failures: first.failures, scores: first.scores };
  const failures = draws.flatMap((draw, index) =>
    draw.failures.map((failure) => `tirage ${String(index + 1)} : ${failure}`),
  );
  const criteria = new Set(draws.flatMap((draw) => Object.keys(draw.scores)));
  const scores: Record<string, number> = {};
  const worst: Record<string, number> = {};
  for (const criterion of criteria) {
    const scored = draws.flatMap((draw) => {
      const score = draw.scores[criterion];
      return score === undefined ? [] : [score];
    });
    scores[criterion] = scored.reduce((sum, score) => sum + score, 0) / scored.length;
    if (scored.length === draws.length) worst[criterion] = Math.min(...scored);
  }
  return { file, failures, scores, worst };
}
