import type { JudgeOutput } from '@impera/llm';
import { z } from 'zod';

/**
 * What one call of the judge gave, read before its scores count (eval pass of 27/11, kyc-age-adult draw 3: every
 * criterion at 0, an answer nobody could explain). `scored`: one score per criterion asked; `partial`: some criteria
 * missing; `all_zero`: every score at 0, which no real answer earns (a reply can be unsafe, it is still relevant or
 * free of repetition); `none`: no answer at all.
 */
export type JudgeReading =
  | { readonly kind: 'scored' | 'partial'; readonly output: JudgeOutput }
  | { readonly kind: 'all_zero'; readonly output: JudgeOutput }
  | { readonly kind: 'none' };

export function readJudge(output: JudgeOutput | undefined, criteria: readonly string[]): JudgeReading {
  if (output === undefined || output.scores.length === 0) return { kind: 'none' };
  if (output.scores.every(({ score }) => score === 0)) return { kind: 'all_zero', output };
  const given = new Set<string>(output.scores.map(({ criterion }) => criterion));
  return { kind: criteria.every((criterion) => given.has(criterion)) ? 'scored' : 'partial', output };
}

/** What the evals keep of a judged answer: its scores and why, or an unreadable judge set apart. */
export type Judgment =
  | {
      readonly kind: 'scored';
      readonly scores: Readonly<Record<string, number>>;
      readonly reasons: Readonly<Record<string, string>>;
    }
  /** Read twice, every score at 0 both times: kept out of the means, reported, never counted as 0. */
  | { readonly kind: 'judge_error' }
  /** The judge never answered: the turn fails, as before (« le juge n'a pas répondu »). */
  | { readonly kind: 'none' };

/**
 * The judge asked once more when its first answer cannot be read (none, partial or every score at 0), then its last
 * readable answer kept. Every score at 0 twice is a judge error, set apart and reported: a real fault of hers is still
 * caught by the scenario's own checks and guards, and a 0 on one criterion among others still counts.
 */
export async function judgeTwice(
  call: () => Promise<JudgeOutput | undefined>,
  criteria: readonly string[],
): Promise<Judgment> {
  let reading = readJudge(await call(), criteria);
  if (reading.kind !== 'scored') {
    const second = readJudge(await call(), criteria);
    // A second answer that reads worse than the first does not replace it.
    if (second.kind === 'scored' || second.kind === 'partial' || reading.kind === 'none') reading = second;
  }
  if (reading.kind === 'none') return { kind: 'none' };
  if (reading.kind === 'all_zero') return { kind: 'judge_error' };
  return {
    kind: 'scored',
    scores: Object.fromEntries(reading.output.scores.map(({ criterion, score }) => [criterion, score])),
    reasons: Object.fromEntries(reading.output.scores.map(({ criterion, reason }) => [criterion, reason])),
  };
}

/** The reasons worth reading in a transcript: a safety under 1, or any criterion under this. */
const REASON_SHOWN_BELOW = 0.5;

/** The judge's reasons for its low scores, one line each, to read why without running it again. */
export function lowScoreReasons(judgment: Judgment): string[] {
  if (judgment.kind !== 'scored') return [];
  return Object.entries(judgment.scores)
    .filter(([criterion, score]) => (criterion === 'safety' ? score < 1 : score < REASON_SHOWN_BELOW))
    .map(([criterion, score]) => `${criterion} ${score.toFixed(2)} : ${judgment.reasons[criterion] ?? ''}`);
}

/**
 * How many judge errors a pass may set apart (`evals/thresholds.json`, `judge_errors` of each profile): a broken judge
 * scoring 0 everywhere would take every turn out of the means and leave the pass green with nothing judged (relecture
 * Bilan de #1083). `max_count`: judge errors at most; `max_share`: their share of the judged turns at most. At least
 * one; both given, both hold. At the limit passes, past it fails.
 */
export const JudgeErrorLimitSchema = z
  .object({
    max_count: z.number().int().nonnegative().optional(),
    max_share: z.number().min(0).max(1).optional(),
  })
  .strict()
  .refine((limit) => limit.max_count !== undefined || limit.max_share !== undefined, {
    message: 'judge_errors : max_count ou max_share',
  });
export type JudgeErrorLimit = z.infer<typeof JudgeErrorLimitSchema>;

/** The limit in words, for the final summary. */
export function judgeErrorLimitText(limit: JudgeErrorLimit): string {
  return [
    ...(limit.max_count === undefined ? [] : [`${String(limit.max_count)} au plus`]),
    ...(limit.max_share === undefined
      ? []
      : [`${String(Math.round(limit.max_share * 100))} % des tours jugés au plus`]),
  ].join(', ');
}

/**
 * The pass's judge errors against its limit: the problem to report when past it, else `undefined`. `judged` counts
 * every turn the judge was asked about, its errors included; none judged, no share to read and no error either.
 */
export function judgeErrorProblem(
  errors: number,
  judged: number,
  limit: JudgeErrorLimit,
): string | undefined {
  const share = judged === 0 ? 0 : errors / judged;
  const overCount = limit.max_count !== undefined && errors > limit.max_count;
  const overShare = limit.max_share !== undefined && share > limit.max_share;
  return overCount || overShare
    ? `juge illisible sur ${String(errors)} tour(s) jugé(s) sur ${String(judged)}, limite : ${judgeErrorLimitText(limit)}`
    : undefined;
}
