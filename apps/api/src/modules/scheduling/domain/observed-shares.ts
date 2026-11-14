import type { Currency, ObservedAgencyShare, Platform, PlatformAccountId } from '@impera/contracts';

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
 * `part / whole` in basis points, rounded to the nearest, a half up: whole numbers only. `null` without a positive
 * whole, or for a part out of it (refunds heavier than the sales leave no share to read).
 */
export function shareBps(part: number, whole: number): number | null {
  if (whole <= 0 || part < 0 || part > whole) return null;
  const scaled = part * WHOLE_BPS;
  const floor = Math.floor(scaled / whole);
  return scaled - floor * whole >= whole - (scaled - floor * whole) ? floor + 1 : floor;
}

/** Each account and currency of the rows, its sums and its share; ordered by account then currency. */
export function observedShares(rows: readonly ObservedTotalsRow[]): ObservedAgencyShare[] {
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
 * `AGENCY_SHARE_CHANGE_BPS`. A fortnight without a net on an account is compared with nothing.
 */
export function agencyShareChanges(
  previous: readonly ObservedTotalsRow[],
  current: readonly ObservedTotalsRow[],
): AgencyShareChange[] {
  const before = new Map(
    observedShares(previous).map((share) => [
      `${share.platform}:${share.platformAccountId}:${share.currency}`,
      share.agencyBps,
    ]),
  );
  const changes: AgencyShareChange[] = [];
  for (const share of observedShares(current)) {
    const previousAgencyBps = before.get(`${share.platform}:${share.platformAccountId}:${share.currency}`);
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
