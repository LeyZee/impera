import { payPeriodAt, type PayPeriod } from '@impera/contracts';

import { ranksReached, type LevelStep } from './levels';
import { streakOf, type Streak, type StreakReport } from './streak';
import { beatsRecord, trophiesOf, type TrophyKind } from './trophies';

/*
 * What a chatter has earned, from the facts of today (ADR 0104 § 12, § 13 and § 15), pure. The job that calls this is
 * replayable: the same facts give the same gains, each under a key that is written once while it holds. A gain a
 * corrected net no longer justifies is taken back (ADR 0118 § 5). A trophy never names an amount, and nothing here
 * reaches pay (§ 17).
 */

/** How long after a shift's end its report still counts on time: until the second reminder rings. */
const REPORT_ON_TIME_HOURS = 12;
const HOUR_MS = 3_600_000;

/** A shift the member held to its end, and when they first handed its report in. */
export interface GameShift {
  readonly endsAt: Date;
  readonly reportedAt: Date | null;
}

/** What the member's statements say: counts and nets, and the tiers reached. */
export interface GamePay {
  readonly sales: number;
  /** The net of each day with sales, the oldest first. */
  readonly dayNetsMinor: readonly number[];
  /** The net of each fortnight before the one under way, the oldest first. */
  readonly closedPeriodNetsMinor: readonly number[];
  readonly tiers: readonly { readonly period: PayPeriod; readonly thresholdMinor: number }[];
  /** The net of all their statements (§ 16). */
  readonly cumulatedNetMinor: number;
}

export type GainKind = TrophyKind | 'tier' | 'level';

/**
 * A gain and the key it is written once under: empty for a trophy, the fortnight and the threshold for a tier, the
 * rank for a level. A level also keeps the threshold it was reached at (`basisMinor`).
 */
export interface Gain {
  readonly kind: GainKind;
  readonly scopeKey: string;
  readonly basisMinor?: number;
}

/** A gain that holds today, as the job reads it back: a level with the threshold it was reached at, when known. */
export interface HeldGain {
  readonly kind: GainKind;
  readonly scopeKey: string;
  readonly basisMinor: number | null;
}

/** The trophies a net gives: a corrected net may take them back. The others reward regularity and stay (ADR 0118 § 5). */
const NET_TROPHIES: ReadonlySet<GainKind> = new Set(['first_sale', 'day_record', 'fortnight_record']);

const keyOf = (gain: { readonly kind: GainKind; readonly scopeKey: string }): string =>
  `${gain.kind} ${gain.scopeKey}`;

/**
 * The gains held that the facts of today no longer justify (ADR 0118 § 5): a trophy tied to a net, or a tier, that
 * `earned` no longer gives; and a rank whose cumulated net fell back under the threshold it was reached at. A rank
 * stays when only the thresholds moved (§ 7): one that today's threshold still gives, one the owner raised above a
 * net that did not move, and one whose threshold at the time is not known.
 */
export function takenBackOf(input: {
  readonly held: readonly HeldGain[];
  readonly earned: readonly Gain[];
  readonly cumulatedNetMinor: number;
}): HeldGain[] {
  const earned = new Set(input.earned.map(keyOf));
  return input.held.filter((gain) => {
    if (earned.has(keyOf(gain))) return false;
    if (gain.kind === 'level') return gain.basisMinor !== null && input.cumulatedNetMinor < gain.basisMinor;
    return gain.kind === 'tier' || NET_TROPHIES.has(gain.kind);
  });
}

export function reportOf(shift: GameShift, now: Date): StreakReport {
  const due = shift.endsAt.getTime() + REPORT_ON_TIME_HOURS * HOUR_MS;
  if (shift.reportedAt !== null) return shift.reportedAt.getTime() <= due ? 'on_time' : 'late';
  return now.getTime() > due ? 'missing' : 'pending';
}

/** Whether one of `netsMinor`, the oldest first, beat the best of those before it. */
const recordBeaten = (netsMinor: readonly number[]): boolean =>
  netsMinor.some((net, index) => beatsRecord(net, netsMinor.slice(0, index)));

/** A fortnight before the one under way with at least one shift, each with its report on time. */
function fortnightOnTime(shifts: readonly GameShift[], now: Date, agencyZone: string): boolean {
  const current = payPeriodAt(now, agencyZone);
  const byPeriod = new Map<PayPeriod, StreakReport[]>();
  for (const shift of shifts) {
    const period = payPeriodAt(shift.endsAt, agencyZone);
    if (period >= current) continue;
    byPeriod.set(period, [...(byPeriod.get(period) ?? []), reportOf(shift, now)]);
  }
  return [...byPeriod.values()].some((reports) => reports.every((report) => report === 'on_time'));
}

/** The key a tier is written once under. */
const tierScopeKey = (tier: { readonly period: PayPeriod; readonly thresholdMinor: number }): string =>
  `${tier.period}:${String(tier.thresholdMinor)}`;

export function gainsOf(input: {
  readonly pay: GamePay;
  readonly shifts: readonly GameShift[];
  readonly now: Date;
  readonly agencyZone: string;
  /** The ranks the owner's thresholds open; empty when none is set. */
  readonly levelSteps: readonly LevelStep[];
}): { readonly gains: Gain[]; readonly streak: Streak } {
  const { pay, shifts, now, agencyZone, levelSteps } = input;
  const streak = streakOf(shifts.map((shift) => ({ endsAt: shift.endsAt, report: reportOf(shift, now) })));
  const trophies = trophiesOf({
    sales: pay.sales,
    dayRecordBeaten: recordBeaten(pay.dayNetsMinor),
    fortnightRecordBeaten: recordBeaten(pay.closedPeriodNetsMinor),
    fortnightOnTime: fortnightOnTime(shifts, now, agencyZone),
    bestStreak: streak.best,
    // The paid media bought in a shift are not counted yet (ADR 0092 § 1): the trophy waits for them.
    ppvBoughtInShift: null,
  });
  return {
    gains: [
      ...trophies.map((kind) => ({ kind, scopeKey: '' })),
      ...pay.tiers.map((tier) => ({ kind: 'tier' as const, scopeKey: tierScopeKey(tier) })),
      ...ranksReached(pay.cumulatedNetMinor, levelSteps).map((step) => ({
        kind: 'level' as const,
        scopeKey: String(step.rank),
        basisMinor: step.thresholdMinor,
      })),
    ],
    streak,
  };
}
