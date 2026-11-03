import { agencyRateFor, type Currency, type Platform, type PlatformAccountId } from '@impera/contracts';

/**
 * The gap between a creator's part as the platform reads it (`modelRevenue`) and the agency's percentage set for her
 * (CRM-04 lot d3, ADR 0054 § 2, question 5), pure. Information for the owner only: it changes no amount, and pay
 * never reads it. On Reveal her part is Reveal's own figure; the percentage only says whether that figure is still
 * the one agreed.
 */

/** One row of the sales totals, as much of it as the comparison needs (contract `SalesTotalsRowSchema`). */
export interface ShareTotalsRow {
  readonly day: string;
  readonly platform: Platform;
  readonly platformAccountId: PlatformAccountId;
  readonly currency: Currency;
  readonly sales: number;
  readonly refunds: number;
  readonly netMinor: number;
  readonly creatorMinor: number;
}

/** A percentage of hers from `fromDay` on (contract `CreatorAgencyRateSchema`). */
export interface ShareRate {
  readonly fromDay: string;
  readonly agencyBps: number;
}

/** An account's fortnight in one currency whose part differs from the percentage by more than rounding explains. */
export interface AgencyShareGap {
  readonly platform: Platform;
  readonly platformAccountId: PlatformAccountId;
  readonly currency: Currency;
  /** The sales of the days compared, those a percentage covers, and the refunds taken off them. */
  readonly sales: number;
  readonly refunds: number;
  /** Her part as the platform reads it, over those days. */
  readonly creatorMinor: number;
  /** Her part as the percentage gives it: the net less the agency's share, rounded to the cent. */
  readonly expectedCreatorMinor: number;
  readonly differenceMinor: number;
}

const WHOLE_BPS = 10_000;

/** `numerator / 10 000` to the nearest cent, a half away from zero: the same rounding whatever the sign. */
function roundBps(numerator: number): number {
  const sign = numerator < 0 ? -1 : 1;
  const magnitude = Math.abs(numerator);
  const whole = Math.floor(magnitude / WHOLE_BPS);
  return sign * (magnitude - whole * WHOLE_BPS >= WHOLE_BPS / 2 ? whole + 1 : whole);
}

interface Sums {
  readonly platform: Platform;
  readonly platformAccountId: PlatformAccountId;
  readonly currency: Currency;
  sales: number;
  refunds: number;
  creatorMinor: number;
  /** Σ net × (10 000 − bps), each day with its own percentage: her expected part in ten-thousandths of a cent. */
  expectedScaled: number;
}

/**
 * The accounts and currencies of a creator's fortnight whose part differs from her percentage by more than one cent
 * per sale (question 5: what rounding sale by sale explains at most), and one more per refund: the platform rounds a
 * refund's two amounts on its own, as it does a sale's. Each day takes the percentage in force on it, so a change in
 * the middle of the fortnight is read as it was meant; a day before her first percentage is not compared, and nothing
 * is when she has none. The test is on whole numbers, `|Σ part × 10 000 − Σ net × (10 000 − bps)| > Σ (sales +
 * refunds) × 10 000`, so no rounding of ours ever makes or hides a gap. A refund is already taken off its sale's day by
 * the totals: it changes both sides alike.
 */
export function agencyShareGaps(
  rows: readonly ShareTotalsRow[],
  rates: readonly ShareRate[],
): AgencyShareGap[] {
  const sums = new Map<string, Sums>();
  for (const row of rows) {
    const rate = agencyRateFor(rates, row.day);
    if (rate === null) continue;
    const key = `${row.platform}:${row.platformAccountId}:${row.currency}`;
    const sum = sums.get(key) ?? {
      platform: row.platform,
      platformAccountId: row.platformAccountId,
      currency: row.currency,
      sales: 0,
      refunds: 0,
      creatorMinor: 0,
      expectedScaled: 0,
    };
    sum.sales += row.sales;
    sum.refunds += row.refunds;
    sum.creatorMinor += row.creatorMinor;
    sum.expectedScaled += row.netMinor * (WHOLE_BPS - rate.agencyBps);
    sums.set(key, sum);
  }
  const gaps: AgencyShareGap[] = [];
  for (const sum of sums.values()) {
    const tolerance = (sum.sales + sum.refunds) * WHOLE_BPS;
    if (Math.abs(sum.creatorMinor * WHOLE_BPS - sum.expectedScaled) <= tolerance) continue;
    const expectedCreatorMinor = roundBps(sum.expectedScaled);
    gaps.push({
      platform: sum.platform,
      platformAccountId: sum.platformAccountId,
      currency: sum.currency,
      sales: sum.sales,
      refunds: sum.refunds,
      creatorMinor: sum.creatorMinor,
      expectedCreatorMinor,
      differenceMinor: sum.creatorMinor - expectedCreatorMinor,
    });
  }
  return gaps.sort(
    (a, b) => a.platformAccountId.localeCompare(b.platformAccountId) || a.currency.localeCompare(b.currency),
  );
}
