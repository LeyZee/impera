import {
  agencyRateFor,
  type Currency,
  type ObservedAgencyShare,
  type Platform,
  type PlatformAccountId,
} from '@impera/contracts';

import { agencyShareGaps, type ShareRate, type ShareTotalsRow } from './agency-shares';

/**
 * The agency's share as the platform reads it (ADR 0054 § 4 and § 5), pure: the sums of the net and of the agency's
 * part of an account's sales, never computed again, and their ratio. Information for the owner only: it changes no
 * amount, and pay never reads it.
 */

/** One row of the sales totals, as much of it as the share needs (contract `SalesTotalsRowSchema`). */
export interface ObservedTotalsRow {
  readonly platform: Platform;
  readonly platformAccountId: PlatformAccountId;
  readonly currency: Currency;
  readonly netMinor: number;
  readonly agencyMinor: number;
}

const WHOLE_BPS = 10_000;

/** More than one point between two fortnights is a change of share, not the rounding of a sale (§ 5). */
const AGENCY_SHARE_CHANGE_BPS = 100;

/**
 * Below this net on a fortnight, in the account's currency's cents, a cent of rounding moves the share by more than a
 * point: such a fortnight is compared with nothing (PAY-04 of the recette of 16/11: 0,03 € of net raised the alert).
 * 20 in the currency: Charles's choice of 16/11.
 */
export const AGENCY_SHARE_CHANGE_MIN_NET_MINOR = 2_000;

/**
 * `part / whole` in basis points, rounded to the nearest, a half up: whole numbers only. `null` without a positive
 * whole, or for a part out of it (refunds heavier than the sales leave no share to read).
 */
export function shareBps(part: number, whole: number): number | null {
  if (whole <= 0 || part < 0 || part > whole) return null;
  const scaled = part * WHOLE_BPS;
  const floor = Math.floor(scaled / whole);
  return scaled - floor * whole >= whole - (scaled - floor * whole) ? floor + 1 : floor;
}

/** An account's share without its comparison with a percentage. */
type ShareSums = Omit<ObservedAgencyShare, 'differsFromRate'>;

const keyOf = (row: {
  readonly platform: Platform;
  readonly platformAccountId: PlatformAccountId;
  readonly currency: Currency;
}): string => `${row.platform}:${row.platformAccountId}:${row.currency}`;

/** Each account and currency of the rows, its sums and its share; ordered by account then currency. */
export function observedShares(rows: readonly ObservedTotalsRow[]): ShareSums[] {
  const sums = new Map<
    string,
    {
      platform: Platform;
      platformAccountId: PlatformAccountId;
      currency: Currency;
      netMinor: number;
      agencyMinor: number;
    }
  >();
  for (const row of rows) {
    const key = `${row.platform}:${row.platformAccountId}:${row.currency}`;
    const sum = sums.get(key) ?? {
      platform: row.platform,
      platformAccountId: row.platformAccountId,
      currency: row.currency,
      netMinor: 0,
      agencyMinor: 0,
    };
    sum.netMinor += row.netMinor;
    sum.agencyMinor += row.agencyMinor;
    sums.set(key, sum);
  }
  return [...sums.values()]
    .map((sum) => ({ ...sum, agencyBps: shareBps(sum.agencyMinor, sum.netMinor) }))
    .sort(
      (a, b) =>
        a.platformAccountId.localeCompare(b.platformAccountId) || a.currency.localeCompare(b.currency),
    );
}

/**
 * The shares of a window (§ 4), each compared with her percentages by the rule of the gap alert (§ 2, § 6:
 * `agencyShareGaps`), so that the sheet and the alert never disagree: `differsFromRate` is `null` for an account none
 * of whose days a percentage covers.
 */
export function sharesAgainstRates(
  rows: readonly (ObservedTotalsRow & ShareTotalsRow)[],
  rates: readonly ShareRate[],
): ObservedAgencyShare[] {
  const covered = new Set(rows.filter((row) => agencyRateFor(rates, row.day) !== null).map(keyOf));
  const gaps = new Set(agencyShareGaps(rows, rates).map(keyOf));
  return observedShares(rows).map((share) => {
    const key = keyOf(share);
    return { ...share, differsFromRate: covered.has(key) ? gaps.has(key) : null };
  });
}

/** An account and currency whose share moved by more than a point from one fortnight to the next (§ 5). */
export interface AgencyShareChange {
  readonly platform: Platform;
  readonly platformAccountId: PlatformAccountId;
  readonly currency: Currency;
  readonly previousAgencyBps: number;
  readonly agencyBps: number;
}

/**
 * The accounts and currencies read in both fortnights, each with a share, whose share moved by more than
 * `AGENCY_SHARE_CHANGE_BPS`. A fortnight whose net on an account is below `AGENCY_SHARE_CHANGE_MIN_NET_MINOR` is
 * compared with nothing: its share is the rounding of a few cents.
 */
export function agencyShareChanges(
  previous: readonly ObservedTotalsRow[],
  current: readonly ObservedTotalsRow[],
): AgencyShareChange[] {
  const enough = (share: ShareSums): boolean => share.netMinor >= AGENCY_SHARE_CHANGE_MIN_NET_MINOR;
  const before = new Map(
    observedShares(previous)
      .filter(enough)
      .map((share) => [keyOf(share), share.agencyBps]),
  );
  const changes: AgencyShareChange[] = [];
  for (const share of observedShares(current).filter(enough)) {
    const previousAgencyBps = before.get(keyOf(share));
    if (previousAgencyBps === undefined || previousAgencyBps === null || share.agencyBps === null) continue;
    if (Math.abs(share.agencyBps - previousAgencyBps) <= AGENCY_SHARE_CHANGE_BPS) continue;
    changes.push({
      platform: share.platform,
      platformAccountId: share.platformAccountId,
      currency: share.currency,
      previousAgencyBps,
      agencyBps: share.agencyBps,
    });
  }
  return changes;
}
