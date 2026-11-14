import { calendarDayAt, type Currency, type PayPeriod } from '@impera/contracts';

import { mainCurrencyOf, type FigureLine } from './my-figures';

/*
 * What the game reads of a member's pay (ADR 0104 § 12 and § 15), pure: counts and nets from the lines of their own
 * statements, and the tiers those statements reached. The game reads; nothing here is ever written back (§ 17).
 */

/** A tier one of the member's statements reached: the fortnight and the threshold, never the bonus. */
export interface TierReached {
  readonly period: PayPeriod;
  readonly thresholdMinor: number;
}

export interface PayGameFacts {
  /** Sales on the member's statements, ever. */
  readonly sales: number;
  /** The net of each day that has sales with an instant, the oldest first, in the currency that brought the most. */
  readonly dayNetsMinor: readonly number[];
  /** The net of each fortnight before the one under way, the oldest first, in the same currency. */
  readonly closedPeriodNetsMinor: readonly number[];
  readonly tiers: readonly TierReached[];
  /** The currency the nets here are in, the one that brought the member the most; `null` with no line. */
  readonly currency: Currency | null;
  /** The net of all their statements, in that currency (§ 16). */
  readonly cumulatedNetMinor: number;
  /** Each line that has an instant, in that currency (§ 14). */
  readonly timedNets: readonly { readonly at: Date; readonly netMinor: number }[];
}

const ascending = <Value>(sums: ReadonlyMap<string, Value>): Value[] =>
  [...sums.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, value]) => value);

export function payGameFacts(input: {
  readonly lines: readonly FigureLine[];
  readonly tiers: readonly TierReached[];
  readonly agencyZone: string;
  /** The fortnight under way: its net still moves, so it sets no record yet. */
  readonly currentPeriod: PayPeriod;
}): PayGameFacts {
  const { lines, tiers, agencyZone, currentPeriod } = input;
  const currency = mainCurrencyOf(lines);
  const byDay = new Map<string, number>();
  const byPeriod = new Map<string, number>();
  let cumulatedNetMinor = 0;
  const timedNets: { at: Date; netMinor: number }[] = [];
  for (const line of lines) {
    if (line.currency !== currency) continue;
    cumulatedNetMinor += line.netMinor;
    if (line.period < currentPeriod)
      byPeriod.set(line.period, (byPeriod.get(line.period) ?? 0) + line.netMinor);
    if (line.occurredAt === null) continue;
    timedNets.push({ at: line.occurredAt, netMinor: line.netMinor });
    const day = calendarDayAt(line.occurredAt, agencyZone);
    byDay.set(day, (byDay.get(day) ?? 0) + line.netMinor);
  }
  return {
    sales: lines.filter((line) => line.event === 'sale').length,
    dayNetsMinor: ascending(byDay),
    closedPeriodNetsMinor: ascending(byPeriod),
    tiers,
    currency,
    cumulatedNetMinor,
    timedNets,
  };
}
