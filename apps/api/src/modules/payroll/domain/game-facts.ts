import { calendarDayAt, type Currency, type PayPeriod, type PlatformAccountId } from '@impera/contracts';

import { platformNetOfGross } from './commission-statements';
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

/**
 * A shift whose reports the agency validated, as the planning gives it to the game (ADR 0118 § 1): when it was held,
 * the total validated in the currency declared, and what pay takes off a gross on that account for that period.
 */
export interface ValidatedShift {
  readonly platformAccountId: PlatformAccountId;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly period: PayPeriod;
  readonly currency: Currency;
  readonly grossMinor: number;
  readonly vatBps: number;
  readonly platformFeeBps: number;
}

/**
 * The validated shifts as lines of the game's net (ADR 0118): each on the day its shift began (§ 2), at the net pay's
 * chain gives its total, in the currency declared. A shift with a sale read in its hours on its own account is left to
 * the sales (§ 3): nothing is counted twice. A sale read on another account says nothing of this shift, so it leaves
 * the report its line. A total of zero or less brings no line.
 */
export function reportLines(shifts: readonly ValidatedShift[], lines: readonly FigureLine[]): FigureLine[] {
  const read = new Map<PlatformAccountId, number[]>();
  for (const line of lines) {
    if (line.occurredAt === null) continue;
    read.set(line.platformAccountId, [
      ...(read.get(line.platformAccountId) ?? []),
      line.occurredAt.getTime(),
    ]);
  }
  return shifts.flatMap((shift) => {
    const from = shift.startsAt.getTime();
    const to = shift.endsAt.getTime();
    if ((read.get(shift.platformAccountId) ?? []).some((at) => at >= from && at < to)) return [];
    const netMinor = platformNetOfGross(shift);
    return netMinor <= 0
      ? []
      : [
          {
            period: shift.period,
            platformAccountId: shift.platformAccountId,
            event: 'sale' as const,
            currency: shift.currency,
            netMinor,
            occurredAt: shift.startsAt,
            saleType: null,
            chain: {
              grossMinor: shift.grossMinor,
              vatBps: shift.vatBps,
              platformFeeBps: shift.platformFeeBps,
            },
          },
        ];
  });
}

export interface PayGameFacts {
  /** Sales on the member's statements, and shifts with a validated total, ever. */
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
  /** The member's shifts with a validated total (ADR 0118); none when the planning was not read. */
  readonly validatedShifts?: readonly ValidatedShift[];
  readonly tiers: readonly TierReached[];
  readonly agencyZone: string;
  /** The fortnight under way: its net still moves, so it sets no record yet. */
  readonly currentPeriod: PayPeriod;
}): PayGameFacts {
  const { tiers, agencyZone, currentPeriod } = input;
  const lines = [...input.lines, ...reportLines(input.validatedShifts ?? [], input.lines)];
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
