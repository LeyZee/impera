import { payPeriodAt, type PayPeriod } from '@impera/contracts';

import { streakOf, type Streak, type StreakReport } from './streak';
import { beatsRecord, trophiesOf, type TrophyKind } from './trophies';

/*
 * What a chatter has earned, from the facts of today (ADR 0104 § 12, § 13 and § 15), pure. The job that calls this is
 * replayable: the same facts give the same gains, each under a key that is written once. A gain never names an
 * amount, and nothing here reaches pay (§ 17).
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
}

export type GainKind = TrophyKind | 'tier';

/** A gain and the key it is written once under: empty for a trophy, the fortnight and the threshold for a tier. */
export interface Gain {
  readonly kind: GainKind;
  readonly scopeKey: string;
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
}): { readonly gains: Gain[]; readonly streak: Streak } {
  const { pay, shifts, now, agencyZone } = input;
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
    ],
    streak,
  };
}
