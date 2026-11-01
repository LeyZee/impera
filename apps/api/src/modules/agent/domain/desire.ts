import { DESIRE_BAND_FLOORS, desireNow, type DesireSignal } from '@nirvana/contracts';

import { NO_SALE_RISKS } from './policy';

/**
 * His desire score (P3-12): how hot he is right now, from 0 to 100, counted by code from closed signals. The brain
 * only reports what it reads in his last message (`desireSignals`), the code counts (CLAUDE.md rule 3). The score
 * only ever holds back: it replaces « he sexualizes now » in the policy and lifts no other condition.
 */

/** Bumped whenever a weight, a bound or the emoji list changes: each score says which counting it came from. */
export const DESIRE_WEIGHTS_VERSION = 'desire-1';

/** Defaults of the persona's thresholds, when her file sets none. */
export const DEFAULT_MIN_DESIRE_TO_OPEN = DESIRE_BAND_FLOORS.playful;
export const DEFAULT_SCRIPT_MIN_DESIRE = DESIRE_BAND_FLOORS.hot;

/**
 * What one message of his moves, in points. The brain's signals on his last message, then what the brief already
 * gives (intent, sentiment), then what code measures without a model. A first counting, to calibrate on the sales
 * corpus (P3-12, « Calibration »).
 */
type CountedSignal = Exclude<DesireSignal, 'minor_suspected' | 'age_disputed' | 'frozen'>;

const WEIGHTS: Readonly<Record<CountedSignal, number>> = {
  // He warms up.
  steers_to_intimate: 12,
  body_compliment: 8,
  asks_about_her_body: 10,
  states_desire: 12,
  explicit_language: 15,
  hot_media_reaction: 12,
  roleplay: 10,
  // He cools down.
  changes_subject: -10,
  cold_reply: -8,
  // He cannot now: a hot fan at work drops out of « hot » on this alone.
  busy_now: -30,
  slows_down: -20,
  discomfort: -30,
  // From the brief.
  'intent:flirt': 6,
  'intent:sexting': 12,
  'intent:asks_for_media': 10,
  'sentiment:aroused': 10,
  // Measured.
  long_reply: 5,
  short_reply: -4,
  quick_reply: 4,
  slow_reply: -4,
  suggestive_emoji: 4,
  several_messages: 4,
};

/** At most this many suggestive emojis count in one message: a row of 🔥 is not ten times hotter. */
const MAX_EMOJIS_COUNTED = 3;
// Suggestive on their own; a heart or a laugh says nothing of his heat.
const SUGGESTIVE_EMOJIS = ['🔥', '😈', '😏', '🥵', '💦', '🍑', '🍆', '👅', '🤤'] as const;

const LONG_RATIO = 1.5;
const SHORT_RATIO = 0.5;
const QUICK_REPLY_S = 120;
const SLOW_REPLY_S = 3_600;
const SEVERAL_MESSAGES = 3;

/** The score as stored, and when it was counted. */
export interface DesireState {
  readonly score: number;
  readonly at: Date;
}

/** What code measures on his messages, without a model. */
export interface DesireMeasure {
  /** The length of his last message(s) over the median of his earlier ones; null without earlier ones. */
  readonly lengthRatio: number | null;
  /** How long he took to answer her last message, in seconds; null when she had not written. */
  readonly replySeconds: number | null;
  /** Suggestive emojis in his last message(s). */
  readonly suggestiveEmojis: number;
  /** His messages in a row without her answer. */
  readonly inARow: number;
}

export const NO_MEASURE: DesireMeasure = {
  lengthRatio: null,
  replySeconds: null,
  suggestiveEmojis: 0,
  inARow: 1,
};

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const countEmojis = (text: string): number =>
  SUGGESTIVE_EMOJIS.reduce((count, emoji) => count + text.split(emoji).length - 1, 0);

/**
 * What code reads of his heat on the conversation: his last run of messages against his earlier ones. Her messages
 * only date his answer; they never raise the score.
 */
export function measureDesire(
  history: readonly { readonly fromFan: boolean; readonly text: string; readonly at: Date }[],
): DesireMeasure {
  let start = history.length;
  while (start > 0 && history[start - 1]?.fromFan === true) start -= 1;
  const last = history.slice(start);
  const first = last[0];
  if (first === undefined) return NO_MEASURE;
  const earlier = history.slice(0, start).filter((turn) => turn.fromFan);
  const usual = median(earlier.map((turn) => turn.text.length));
  const length = last.reduce((sum, turn) => sum + turn.text.length, 0);
  const hers = history[start - 1];
  return {
    lengthRatio: usual === null || usual === 0 ? null : length / usual,
    replySeconds: hers === undefined ? null : Math.max(0, (first.at.getTime() - hers.at.getTime()) / 1_000),
    suggestiveEmojis: last.reduce((sum, turn) => sum + countEmojis(turn.text), 0),
    inARow: last.length,
  };
}

const bounded = (score: number): number => Math.min(100, Math.max(0, Math.round(score)));

/** One message of his, as the score reads it. */
export interface DesireTurn {
  readonly previous: DesireState | undefined;
  /** The brain's `desireSignals` on his last message. */
  readonly signals: readonly string[];
  readonly intent: string;
  readonly sentiment: string;
  readonly measured: DesireMeasure;
  /** The brain's risks on his message. */
  readonly risks: readonly string[];
  /** A human or the policy took his stated age back (`ageDisputed`). */
  readonly ageDisputed: boolean;
  readonly now: Date;
  readonly floor?: number;
}

export interface DesireReading {
  /**
   * The stored score decayed to now, before this message (`null` before his first score): the worker writes an
   * event only when it differs.
   */
  readonly before: number | null;
  readonly score: number;
  /**
   * What moved it, in the order counted: the signals' codes, or the reason it was frozen or reset. A code may
   * repeat (`suggestive_emoji` once per emoji counted).
   */
  readonly signals: readonly DesireSignal[];
  readonly weightsVersion: string;
}

const reading = (
  previous: DesireState | undefined,
  before: number,
  score: number,
  signals: readonly DesireSignal[],
): DesireReading => ({
  before: previous === undefined ? null : before,
  score,
  signals,
  weightsVersion: DESIRE_WEIGHTS_VERSION,
});

function measuredSignals(measured: DesireMeasure): CountedSignal[] {
  const signals: CountedSignal[] = [];
  if (measured.lengthRatio !== null && measured.lengthRatio >= LONG_RATIO) signals.push('long_reply');
  if (measured.lengthRatio !== null && measured.lengthRatio <= SHORT_RATIO) signals.push('short_reply');
  if (measured.replySeconds !== null && measured.replySeconds < QUICK_REPLY_S) signals.push('quick_reply');
  if (measured.replySeconds !== null && measured.replySeconds > SLOW_REPLY_S) signals.push('slow_reply');
  const emojis = Math.min(MAX_EMOJIS_COUNTED, measured.suggestiveEmojis);
  for (let i = 0; i < emojis; i += 1) signals.push('suggestive_emoji');
  if (measured.inARow >= SEVERAL_MESSAGES) signals.push('several_messages');
  return signals;
}

const isCounted = (signal: string): signal is CountedSignal => Object.hasOwn(WEIGHTS, signal);

/**
 * His score after his new message: the stored one decayed to now, plus what this message moves, within 0 and 100.
 * A possible minor or a disputed age resets it to 0; a risk that stops any sale freezes it as it stands.
 */
export function desireScore(turn: DesireTurn): DesireReading {
  const before = desireNow(turn.previous, turn.now, turn.floor);
  if (turn.risks.includes('minor_suspected')) return reading(turn.previous, before, 0, ['minor_suspected']);
  if (turn.ageDisputed) return reading(turn.previous, before, 0, ['age_disputed']);
  // A risk that stops any sale freezes it: nothing is counted on such a message (`offerDecision` blocks anyway).
  if (turn.risks.some((risk) => NO_SALE_RISKS.includes(risk))) {
    return reading(turn.previous, before, before, ['frozen']);
  }
  const signals: CountedSignal[] = [
    ...new Set(turn.signals.filter(isCounted)),
    ...[`intent:${turn.intent}`, `sentiment:${turn.sentiment}`].filter(isCounted),
    ...measuredSignals(turn.measured),
  ];
  const moved = signals.reduce((sum, signal) => sum + WEIGHTS[signal], 0);
  return reading(turn.previous, before, bounded(before + moved), signals);
}

/** Whether this message moved his score: only then is it journaled (a first score of 0 moves nothing). */
export const desireMoved = (reading: DesireReading): boolean => reading.score !== (reading.before ?? 0);
