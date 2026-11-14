import {
  FAN_AVAILABILITY_NEGATIVE_SIGNALS,
  FAN_AVAILABILITY_POSITIVE_SIGNALS,
  type FanAvailabilityRecord,
  type ScriptStart,
  type ScriptStartBlock,
} from '@impera/contracts';

/**
 * His availability and the gate before a script (ADR 0103, amendement du 13/11; ADR 0098). The brain only reports
 * signals in his last message; code holds the state, its lapse and the gate (CLAUDE.md rule 3).
 *
 * The session is the one of ADR 0098 § 12, the hot session: it ends when his desire, having reached her script
 * threshold, falls back under it. What the session remembers (his availability, that he sexualized, that she asked)
 * also lapses 2 hours after it was said: a « je suis seul » of the day before never opens today's script.
 */

export type { FanAvailabilityRecord, ScriptStart, ScriptStartBlock };

/** How long what he said of his availability, his sexualizing or her question holds within a session. */
export const FAN_AVAILABILITY_TTL_MS = 2 * 60 * 60_000;

type Positive = (typeof FAN_AVAILABILITY_POSITIVE_SIGNALS)[number];
type Negative = (typeof FAN_AVAILABILITY_NEGATIVE_SIGNALS)[number];

const isPositive = (signal: string): signal is Positive =>
  FAN_AVAILABILITY_POSITIVE_SIGNALS.some((s) => s === signal);
const isNegative = (signal: string): signal is Negative =>
  FAN_AVAILABILITY_NEGATIVE_SIGNALS.some((s) => s === signal);

/** Nothing known: a new session, or what he said lapsed. */
export const UNKNOWN_AVAILABILITY: FanAvailabilityRecord = {
  state: 'unknown',
  signal: null,
  at: null,
  expiresAt: null,
  seen: [],
  sexualizedAt: null,
  askedAt: null,
  hotAt: null,
};

/**
 * Confirmed once he said, in the session, that he is alone and free: « chez lui » alone does not say nobody is there,
 * and « seul » alone does not say he has time. `at_home` is kept as a sign, not as one of the two.
 */
const confirms = (seen: readonly Positive[]): boolean => seen.includes('alone') && seen.includes('free_now');

const live = (at: Date | null, now: Date): Date | null =>
  at !== null && now.getTime() - at.getTime() < FAN_AVAILABILITY_TTL_MS ? at : null;

export interface AvailabilityTurn {
  /** As stored on the conversation; `null` before the first. */
  readonly previous: FanAvailabilityRecord | null;
  /** The brain's `desireSignals` on his last message; `null` when nothing of his is read (a brain that failed). */
  readonly signals: readonly string[] | null;
  /** His last message sexualizes (`sexualizes`). */
  readonly sexualizes: boolean;
  /** His desire after this message, and her script threshold (`limits.minDesire`). */
  readonly desire: number;
  readonly threshold: number;
  readonly now: Date;
}

/**
 * The record after his message: lapsed parts dropped, the session reset when it cooled, then his signals applied.
 * A negative signal wins over a positive one in the same message (« je suis seul mais je dois partir »).
 */
export function readAvailability(turn: AvailabilityTurn): FanAvailabilityRecord {
  const { now } = turn;
  const stored = turn.previous ?? UNKNOWN_AVAILABILITY;
  // The hot session ended: he reached her threshold since, and is back under it (ADR 0098 § 12).
  const cooled = stored.hotAt !== null && turn.desire < turn.threshold;
  const kept = cooled ? UNKNOWN_AVAILABILITY : stored;
  const stateLive = kept.expiresAt !== null && kept.expiresAt.getTime() > now.getTime();
  const base: FanAvailabilityRecord = {
    ...(stateLive ? kept : { ...kept, state: 'unknown', signal: null, at: null, expiresAt: null, seen: [] }),
    sexualizedAt: live(kept.sexualizedAt, now),
    askedAt: live(kept.askedAt, now),
    // When he first reached her threshold in this session: kept, so that the record changes only when something does.
    hotAt: turn.desire >= turn.threshold ? (kept.hotAt ?? now) : kept.hotAt,
  };
  const withSex = turn.sexualizes ? { ...base, sexualizedAt: now } : base;
  const signals = turn.signals ?? [];
  const expiresAt = new Date(now.getTime() + FAN_AVAILABILITY_TTL_MS);
  const negative = signals.find(isNegative);
  if (negative !== undefined) {
    return { ...withSex, state: 'no', signal: negative, at: now, expiresAt, seen: [] };
  }
  const positives = signals.filter(isPositive);
  if (positives.length === 0) return withSex;
  // A « non » earlier in the session is lifted only by what he says now, never by an older « seul ».
  const before = withSex.state === 'no' ? [] : withSex.seen;
  const seen = FAN_AVAILABILITY_POSITIVE_SIGNALS.filter((s) => before.includes(s) || positives.includes(s));
  const last = positives[positives.length - 1] ?? null;
  return {
    ...withSex,
    state: confirms(seen) ? 'confirmed' : 'unknown',
    signal: last,
    at: now,
    expiresAt,
    seen,
  };
}

/**
 * His message sexualizes (ADR 0103 § 11): he goes there himself, in his own words. A plain flirt does not: Charles
 * wants a fan who already sexualizes, not one who smiles.
 */
const SEXUALIZING_SIGNALS: readonly string[] = [
  'steers_to_intimate',
  'states_desire',
  'explicit_language',
  'roleplay',
  'asks_about_her_body',
  'hot_media_reaction',
];

export function sexualizes(brief: {
  readonly intent: string;
  readonly sentiment: string;
  readonly desireSignals?: readonly string[] | undefined;
}): boolean {
  return (
    brief.intent === 'sexting' ||
    brief.sentiment === 'aroused' ||
    (brief.desireSignals ?? []).some((signal) => SEXUALIZING_SIGNALS.includes(signal))
  );
}

/**
 * The gate before the first teaser (ADR 0103 § 11): no script starts, offered teasing included, without his desire at
 * her script threshold, a message of his that sexualized in the session, and his availability confirmed. Every missing
 * condition is listed, in that order.
 */
export function scriptStartGate(
  record: FanAvailabilityRecord,
  desire: number,
  threshold: number,
): ScriptStart {
  const missing: ScriptStartBlock[] = [];
  if (desire < threshold) missing.push('desire_below_threshold');
  if (record.sexualizedAt === null) missing.push('not_sexualizing');
  if (record.state !== 'confirmed') missing.push('availability_unconfirmed');
  const [first, ...rest] = missing;
  return first === undefined ? { open: true } : { open: false, missing: [first, ...rest] };
}

/**
 * She asks him, in passing, whether he is free (§ 13): only when his availability is all that is missing, and once
 * per session.
 */
export function asksAvailability(record: FanAvailabilityRecord, gate: ScriptStart): boolean {
  return (
    !gate.open &&
    gate.missing.length === 1 &&
    gate.missing[0] === 'availability_unconfirmed' &&
    record.state === 'unknown' &&
    record.askedAt === null
  );
}

/** Whether two records differ: only then is `fan_availability_changed` journaled. */
export function availabilityChanged(a: FanAvailabilityRecord | null, b: FanAvailabilityRecord): boolean {
  const stamp = (record: FanAvailabilityRecord | null): string =>
    JSON.stringify(record, (_, value: unknown) => (value instanceof Date ? value.toISOString() : value));
  return stamp(a) !== stamp(b);
}
