import { z } from 'zod';

/**
 * The desire score of a conversation (P3-12, glossary « Note de désir »): how hot the fan is, from 0 to 100, counted
 * by the agent's code from closed signals. The engine computes it; the conversation journal keeps each change
 * (`desire_scored`) and the conversation row projects the last one. The band is never stored apart from its score:
 * it is `desireBandOf(score)`, so the two cannot disagree.
 */

export const DESIRE_SCORE_MIN = 0;
export const DESIRE_SCORE_MAX = 100;

export const DesireScoreSchema = z.number().int().min(DESIRE_SCORE_MIN).max(DESIRE_SCORE_MAX);

/** Neutre (0 to 39), joueur (40 to 69), chaud (70 to 100). */
export const DESIRE_BANDS = ['neutral', 'playful', 'hot'] as const;
export const DesireBandSchema = z.enum(DESIRE_BANDS);
export type DesireBand = z.infer<typeof DesireBandSchema>;

/** The lowest score of each band above `neutral`. */
export const DESIRE_BAND_FLOORS = { playful: 40, hot: 70 } as const;

export function desireBandOf(score: number): DesireBand {
  if (score >= DESIRE_BAND_FLOORS.hot) return 'hot';
  if (score >= DESIRE_BAND_FLOORS.playful) return 'playful';
  return 'neutral';
}

/** What the brain may read in his last message (`desireSignals` of the brief): the code alone counts them. */
export const DESIRE_BRAIN_SIGNALS = [
  'steers_to_intimate',
  'body_compliment',
  'asks_about_her_body',
  'states_desire',
  'explicit_language',
  'hot_media_reaction',
  'roleplay',
  'changes_subject',
  'cold_reply',
  'busy_now',
  'slows_down',
  'discomfort',
] as const;

/**
 * Every code a change of score can carry: the brain's signals, what the brief already says (intent, sentiment), what
 * code measures on his messages, then why it was reset (`minor_suspected`, `age_disputed`) or frozen (`frozen`). A
 * closed list, so that every screen has a label for each. A code may repeat in one change: `suggestive_emoji` counts
 * once per emoji, up to three.
 */
export const DESIRE_SIGNALS = [
  ...DESIRE_BRAIN_SIGNALS,
  'intent:flirt',
  'intent:sexting',
  'intent:asks_for_media',
  'sentiment:aroused',
  'long_reply',
  'short_reply',
  'quick_reply',
  'slow_reply',
  'suggestive_emoji',
  'several_messages',
  'minor_suspected',
  'age_disputed',
  'frozen',
] as const;
export const DesireSignalSchema = z.enum(DESIRE_SIGNALS);
export type DesireSignal = z.infer<typeof DesireSignalSchema>;

/** At most this many signals are kept per change. */
export const DESIRE_SIGNALS_MAX = 20;

/** Without a message of his, the score halves every 90 minutes toward its floor. */
const DESIRE_HALF_LIFE_MS = 90 * 60_000;

/**
 * The score now, from the one stored (`desire_score` at `desire_at`): it halves every 90 minutes without a message of
 * his, toward `floor` (20 once he bought in the last seven days, read from `sales` once P6-01 exists; 0 until then).
 * Applied on read, by the engine and by the tracking screens alike: nothing stores a cooled score, and the stored band
 * is the band of the stored score, not of this one.
 */
export function desireNow(
  state: { readonly score: number; readonly at: Date } | undefined,
  now: Date,
  floor = 0,
): number {
  if (state === undefined) return 0;
  const bounded = (score: number): number =>
    Math.min(DESIRE_SCORE_MAX, Math.max(DESIRE_SCORE_MIN, Math.round(score)));
  if (state.score <= floor) return bounded(state.score);
  const elapsed = Math.max(0, now.getTime() - state.at.getTime());
  return bounded(floor + (state.score - floor) * 0.5 ** (elapsed / DESIRE_HALF_LIFE_MS));
}
