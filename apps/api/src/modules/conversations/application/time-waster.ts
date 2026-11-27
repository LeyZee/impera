import type { FanFlags, FanSign, TimeWasterSetting } from '@impera/contracts';

import {
  fanStanding,
  type FanStanding,
  nextLocalTime,
  slowedReplyAt,
  timeWasterLevel,
  TIRESOME_WINDOW_DAYS,
  type TimeWasterLevel,
} from '../../agent';
import type { StoredScriptRun } from '../domain/ports';

/**
 * The scarce attention of a time-waster (ADR 0135 § 6, Charles 26/11 and 27/11), before any call to the AI: when he is
 * one, her answer waits a drawn delay from his first message waiting, his next messages joining it, and her answers of
 * the day are counted. Code reads facts only; without her rule set by the agency, nobody waits.
 */
export interface TimeWasterRead {
  readonly now: Date;
  readonly timeZone: string;
  readonly conversationId: string;
  readonly setting: TimeWasterSetting | undefined;
  readonly flags: FanFlags | null;
  readonly careOpen: boolean;
  readonly firstMessageAt: Date | null;
  /** What he spent: the larger of her messages paid and her sales register, refunds out. */
  readonly spentMinor: number;
  readonly lastPurchaseAt: Date | null | undefined;
  readonly unboughtRuns: number;
  /** His runs left in plan (`stalled`), latest first. */
  readonly stalledRuns: readonly StoredScriptRun[];
  /** The signs journaled these last days (`fan_signs_seen`), oldest first. */
  readonly fanSigns: readonly { readonly sign: FanSign; readonly at: Date }[];
  readonly history: readonly { readonly author: string; readonly at: Date }[];
}

export interface TimeWasterWait {
  readonly level: TimeWasterLevel;
  /** When she may answer him; `null`, now. */
  readonly until: Date | null;
}

/** Her clock when her hours are not set: her day, for a time-waster's answers of the day. */
export const DEFAULT_TIME_ZONE = 'Europe/Paris';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const TIRESOME_WINDOW_MS = TIRESOME_WINDOW_DAYS * DAY_MS;

/** His proofs asked before this message, ever (method § 10.25.1). */
export function proofAsksOf(read: Pick<TimeWasterRead, 'fanSigns'>): number {
  return read.fanSigns.filter(({ sign }) => sign === 'asks_proof').length;
}

/**
 * Where he stands with her (ADR 0135), read once: the same reading decides her rhythm here, and the proof and his photo
 * in the composer. Without her rule, nobody is a time-waster by his scripts; his third doubt after a proof, never
 * having paid, makes him one whatever (method § 10.25.1).
 */
export function standingOf(read: Omit<TimeWasterRead, 'flags' | 'careOpen' | 'history'>): FanStanding {
  const { setting } = read;
  return fanStanding(
    {
      now: read.now,
      knownHours:
        read.firstMessageAt === null ? 0 : (read.now.getTime() - read.firstMessageAt.getTime()) / HOUR_MS,
      spentCents: read.spentMinor,
      ...(read.lastPurchaseAt !== undefined && { lastSpentAt: read.lastPurchaseAt }),
      unenteredScripts: read.unboughtRuns,
      proofAsksBefore: proofAsksOf(read),
    },
    setting === undefined
      ? undefined
      : { minUnenteredScripts: setting.minUnenteredScripts, provenHours: setting.provenHours },
  );
}

/** `null` when he is answered as usual: no rule, not a time-waster, or protected. */
export function timeWasterWait(read: TimeWasterRead): TimeWasterWait | null {
  const { setting, flags } = read;
  if (setting === undefined || flags === null) return null;
  const standing = standingOf(read);
  const level = timeWasterLevel({
    standing,
    unenteredScripts: read.unboughtRuns,
    minUnenteredScripts: setting.minUnenteredScripts,
    distinctSigns: tiresomeSigns(read).size,
    protectedFan:
      read.careOpen ||
      flags.fragile === true ||
      flags.salesFrozen !== undefined ||
      flags.doNotContact === true ||
      flags.ageDisputed !== undefined,
  });
  if (level === null) return null;
  const lastHers = read.history.findLastIndex((message) => message.author !== 'fan');
  const waitingSince = read.history.slice(lastHers + 1).find((message) => message.author === 'fan')?.at;
  if (waitingSince === undefined) return { level, until: null };
  const nextDayStart = nextLocalTime(read.now, read.timeZone, 0, 0);
  const until = slowedReplyAt({
    now: read.now,
    level,
    waitingSince,
    repliesToday: herTurnsSince(read.history, new Date(nextDayStart.getTime() - DAY_MS)),
    nextDayStart,
    seed: `${read.conversationId}:${waitingSince.toISOString()}`,
    setting,
  });
  return { level, until };
}

/** From when the signs count (ADR 0135, 14 days). */
function signsSince(now: Date): Date {
  return new Date(now.getTime() - TIRESOME_WINDOW_MS);
}

/** Every sign journaled is read: his proofs asked count since the start (§ 10.25.1), the others over 14 days. */
export const ALL_SIGNS_SINCE = new Date(0);

/** A purchase promised is broken once this old with nothing bought (Charles, 27/11). */
const PROMISE_KEPT_WITHIN_MS = 48 * HOUR_MS;
/** Signs that count only when seen this many times (Charles, 27/11: twice or more). */
const REPEATED_SIGNS: ReadonlySet<FanSign> = new Set(['contact_insistence', 'purchase_promise']);
const REPEATS = 2;

/**
 * The different signs of a tiresome fan in the last 14 days, since his last apology (Charles, 27/11): an apology
 * starts them again, which brings him back to « slowed ». A contact asked for and a purchase promised and not kept
 * count from the second; he left a script just after its paid step, never having bought, is read in his runs.
 */
function tiresomeSigns(read: TimeWasterRead): Set<string> {
  const window = signsSince(read.now).getTime();
  const apology = read.fanSigns.findLast(({ sign }) => sign === 'apologised')?.at.getTime() ?? 0;
  const since = Math.max(window, apology);
  // An apology starts them again, and a proof asked is never a sign by itself (§ 10.25.1 counts those).
  const seen = read.fanSigns.filter(
    ({ sign, at }) => sign !== 'apologised' && sign !== 'asks_proof' && at.getTime() > since,
  );
  const counts = new Map<FanSign, number>();
  for (const { sign, at } of seen) {
    // A promise counts once it is broken: old enough, and nothing bought since.
    if (sign === 'purchase_promise' && read.now.getTime() - at.getTime() < PROMISE_KEPT_WITHIN_MS) continue;
    counts.set(sign, (counts.get(sign) ?? 0) + 1);
  }
  const signs = new Set<string>(
    [...counts]
      .filter(([sign, count]) => !REPEATED_SIGNS.has(sign) || count >= REPEATS)
      .map(([sign]) => sign),
  );
  const left = read.stalledRuns.some(
    ({ run }) =>
      (run.endedAt?.getTime() ?? 0) > since &&
      run.steps.some((step) => step.kind === 'paid' && step.outcome !== 'bought') &&
      !run.steps.some((step) => step.outcome === 'bought'),
  );
  if (left) signs.add('left_mid_script');
  return signs;
}

/** Her answers since `since`: each run of her messages between two of his counts once. */
function herTurnsSince(history: TimeWasterRead['history'], since: Date): number {
  let turns = 0;
  let inHers = false;
  for (const message of history) {
    const hers = message.author !== 'fan';
    if (hers && !inHers && message.at >= since) turns += 1;
    inHers = hers;
  }
  return turns;
}
