import type { FanAvailabilityRecord } from '@impera/contracts';

/**
 * The exception « au travail » (Charles 26/11, ADR 0098 amendement du 26/11). A fan at work (`busy_now`) normally gets
 * no script. Code alone makes the exception: a faithful fan (scripts bought), who wrote to her by himself from his
 * work, and not more than once per span. She warms him up on the theme of his work first; a script may start only once
 * he bites (he sexualizes himself); she stops dead the moment he says he cannot. The words are hers; the span, the count
 * and the gate are here.
 */

/** Scripts he bought from her (one paid step at least) before she may warm him up at his work. */
export const WORK_TEASE_MIN_SCRIPTS_BOUGHT = 2;
/** At most one work tease per fan in this span, counted from the start of the last one. */
export const WORK_TEASE_COOLDOWN_MS = 14 * 24 * 60 * 60_000;
/** How long one work tease lasts once started: past it, his « au boulot » is the ordinary rule again. */
export const WORK_TEASE_SESSION_MS = 3 * 60 * 60_000;
/** He wrote by himself: her last message before his is older than this, or there is none. */
export const HE_WROTE_FIRST_GAP_MS = 2 * 60 * 60_000;

type WorkTease = NonNullable<FanAvailabilityRecord['workTease']>;

/**
 * Where the exception stands at his message. `tease`: she warms him up on his work, no script. `may_start`: he bit, a
 * script may start despite his being at work. `stopped`: he said he cannot, she stops dead, on this message only.
 */
export type WorkTeasePhase = 'none' | 'tease' | 'may_start' | 'stopped';

/** The signals by which he says he cannot (now, here, with someone near). */
const DECLINES: readonly string[] = [
  'slows_down',
  'discomfort',
  'someone_nearby',
  'leaving_soon',
  'cold_reply',
];

export interface WorkTeaseInput {
  readonly previous: WorkTease | null;
  readonly now: Date;
  /** The brain's `desireSignals` on his last message. */
  readonly signals: readonly string[];
  /** His scripts with at least one paid step bought (Reveal's history). */
  readonly scriptsBought: number;
  /** He wrote by himself (`heWroteFirst`). */
  readonly heWroteFirst: boolean;
  /** His message sexualizes, in his own words (`sexualizes`). */
  readonly bites: boolean;
  /** Anything sexual is allowed with him: adult age confirmed, nothing explicit not asked, no care, no risk. */
  readonly allowed: boolean;
}

export interface WorkTeaseOutcome {
  readonly phase: WorkTeasePhase;
  readonly record: WorkTease | null;
}

/** He wrote by himself: nothing of hers before his last run of messages, or hers older than `HE_WROTE_FIRST_GAP_MS`. */
export function heWroteFirst(
  history: readonly { readonly fromFan: boolean; readonly at?: Date }[],
  now: Date,
): boolean {
  let end = history.length;
  while (end > 0 && history[end - 1]?.fromFan === true) end -= 1;
  const hers = history[end - 1];
  if (hers === undefined) return true;
  const firstOfHis = history[end]?.at ?? now;
  return hers.at !== undefined && firstOfHis.getTime() - hers.at.getTime() >= HE_WROTE_FIRST_GAP_MS;
}

/** The exception at his message: started, going on, bitten, stopped, or none (see `WorkTeasePhase`). */
export function workTeaseTurn(input: WorkTeaseInput): WorkTeaseOutcome {
  const { previous, now } = input;
  const declines = input.signals.some((signal) => DECLINES.includes(signal));
  const live = previous !== null && now.getTime() - previous.startedAt.getTime() < WORK_TEASE_SESSION_MS;
  if (live) {
    // Stopped once, it stays stopped until the span is over: his « au boulot » is the ordinary rule again.
    if (previous.stoppedAt !== null) return { phase: 'none', record: previous };
    if (declines || !input.allowed) return { phase: 'stopped', record: { ...previous, stoppedAt: now } };
    if (previous.bitAt !== null || input.bites)
      return { phase: 'may_start', record: { ...previous, bitAt: previous.bitAt ?? now } };
    return { phase: 'tease', record: previous };
  }
  const due = previous === null || now.getTime() - previous.startedAt.getTime() >= WORK_TEASE_COOLDOWN_MS;
  const starts =
    due &&
    input.allowed &&
    !declines &&
    input.signals.includes('busy_now') &&
    input.heWroteFirst &&
    input.scriptsBought >= WORK_TEASE_MIN_SCRIPTS_BOUGHT;
  // She teases first, even when his first message already goes there: the script waits for his answer to her.
  return starts
    ? { phase: 'tease', record: { startedAt: now, bitAt: null, stoppedAt: null } }
    : { phase: 'none', record: previous };
}
