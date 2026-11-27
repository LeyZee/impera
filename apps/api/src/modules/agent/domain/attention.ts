import type { TimeWasterSetting } from '@impera/contracts';

import type { FanStanding } from './standing';

/**
 * A time-waster's scarce attention (ADR 0135 § B, Charles 26/11): « slowed » for the one who only lacks trust or time,
 * whose door she keeps looking for, a little less available; « dormant » for the truly tiresome one who will never
 * buy, answered rarely until he buys, tips or apologises. Code decides it from facts, never the brain. Payers and
 * whales always come first; nothing is ever said about money (`money_reproach`).
 */
export type TimeWasterLevel = 'slowed' | 'dormant';

export interface AttentionFacts {
  readonly standing: FanStanding;
  /** Her scripts sent to him that he never entered, and the agency's count for a time-waster. */
  readonly unenteredScripts: number;
  readonly minUnenteredScripts: number;
  /** The different signs of a tiresome fan seen these last days (`TIRESOME_WINDOW_DAYS`), counted by code. */
  readonly distinctSigns: number;
  /** He apologised since the signs were counted: back to slowed, not further (Charles 26/11). */
  readonly apologised?: boolean;
  /**
   * Never a time-waster, whatever the figures (ADR 0135 § 3): fragile, in care, sales frozen, not to contact. Safety
   * comes first.
   */
  readonly protectedFan: boolean;
}

/** The truly tiresome one (Charles, 27/11): three times the scripts refused, and two different signs in 14 days. */
const DORMANT_SCRIPTS_FACTOR = 3;
const DORMANT_MIN_SIGNS = 2;
export const TIRESOME_WINDOW_DAYS = 14;

/** His level, or `null`: a payer, a new fan or a protected one is answered as usual. */
export function timeWasterLevel(facts: AttentionFacts): TimeWasterLevel | null {
  if (facts.protectedFan) return null;
  if (facts.standing !== 'time_waster' && facts.standing !== 'proven_time_waster') return null;
  const tiresome =
    facts.unenteredScripts >= DORMANT_SCRIPTS_FACTOR * facts.minUnenteredScripts &&
    facts.distinctSigns >= DORMANT_MIN_SIGNS;
  return tiresome && facts.apologised !== true ? 'dormant' : 'slowed';
}

export interface SlowedReplyFacts {
  readonly now: Date;
  readonly level: TimeWasterLevel;
  /** His first message she has not answered yet: the wait runs from it, so that his next ones are grouped. */
  readonly waitingSince: Date;
  /** Her answers to him since the start of her day (one per group of her bubbles). */
  readonly repliesToday: number;
  /** The start of her next day, on her clock: past her answers of the day, the wait moves there. */
  readonly nextDayStart: Date;
  /** Stable per wait, never guessable: the conversation and the message waited on. */
  readonly seed: string;
  readonly setting: TimeWasterSetting;
}

const MINUTE_MS = 60_000;

/**
 * When she may answer him, or `null` when she may now (ADR 0135 § 6): a delay drawn in the agency's range for his
 * level, never fixed, from his first message waiting; once her answers of the day are spent, her next day.
 */
export function slowedReplyAt(facts: SlowedReplyFacts): Date | null {
  const range =
    facts.level === 'dormant' ? facts.setting.dormantDelayMinutes : facts.setting.slowedDelayMinutes;
  const perDay =
    facts.level === 'dormant' ? facts.setting.dormantRepliesPerDay : facts.setting.slowedRepliesPerDay;
  const minutes = range.min + (hash(facts.seed) % (range.max - range.min + 1));
  const delayed = facts.waitingSince.getTime() + minutes * MINUTE_MS;
  const at = facts.repliesToday >= perDay ? Math.max(delayed, facts.nextDayStart.getTime()) : delayed;
  return at <= facts.now.getTime() ? null : new Date(at);
}

/** FNV-1a, 32 bits: the same seed, the same delay. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
