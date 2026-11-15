import type {
  CreatorId,
  PlatformDailyStatsDay,
  SaleSeller,
  SalesFeedReading,
  SalesByChatterRow,
  SalesLine,
  SalesTotals,
  TeamImportLinked,
  TeamScope,
} from '@impera/contracts';

import type { TeamImportContext } from './team-import';

/**
 * Who reads a creator's figures through the connectors' reads (ADR 0026 § 1, ADR 0105 § 4), as the transaction of
 * `withTenantMember` sees him: his team scope, and whether she is on his list (`creator_ids`).
 */
export interface FiguresReader {
  readonly scope: TeamScope;
  readonly onList: boolean;
}

/**
 * The owner reads every creator's sales and statistics; an active manager those of the creators of his list, as the
 * policy of the daily statistics already says (ADR 0081 § 5). A scope of one's own reads nothing of them, not even the
 * totals: taking his own sales off the whole would give him the others' (ADR 0043 § 7).
 */
export function readsCreatorFigures(reader: FiguresReader): boolean {
  return reader.scope === 'owner' || (reader.scope === 'agency' && reader.onList);
}

/** The creators asked, once each and in their order: a creator named twice is read once. */
export function distinctCreators(creatorIds: readonly CreatorId[]): CreatorId[] {
  return [...new Set(creatorIds)];
}

/**
 * The totals' rows without the agency's nor the creator's share (ADR 0105 § 3): nothing a rate can be read back from.
 * Each field is named, so that a field added to the totals stays out until a review lets it in.
 */
export function salesLinesOf(totals: SalesTotals): SalesLine[] {
  return totals.rows.map((row) => ({
    day: row.day,
    platform: row.platform,
    platformAccountId: row.platformAccountId,
    currency: row.currency,
    saleType: row.saleType,
    seller: row.seller,
    sales: row.sales,
    refunds: row.refunds,
    grossInclVatMinor: row.grossInclVatMinor,
    grossExclVatMinor: row.grossExclVatMinor,
    netMinor: row.netMinor,
  }));
}

const sellerKey = (seller: SaleSeller): string =>
  seller.kind === 'member' ? `member:${seller.memberId}` : seller.kind;

/**
 * The totals by seller over the whole period (CRM-04, the reading by chatter of ADR 0078), by platform and currency:
 * sums of the platform's amounts only, each currency apart, never the shares. Ordered by platform, currency, then net
 * from the highest, then seller, so that two reads of the same register give the same list.
 */
export function salesByChatterOf(
  totals: SalesTotals,
  names: ReadonlyMap<string, string>,
): SalesByChatterRow[] {
  const rows = new Map<string, SalesByChatterRow>();
  for (const row of totals.rows) {
    const key = `${row.platform}|${row.currency}|${sellerKey(row.seller)}`;
    const previous = rows.get(key);
    rows.set(key, {
      platform: row.platform,
      currency: row.currency,
      seller: row.seller,
      sellerDisplayName: row.seller.kind === 'member' ? (names.get(row.seller.memberId) ?? null) : null,
      sales: (previous?.sales ?? 0) + row.sales,
      refunds: (previous?.refunds ?? 0) + row.refunds,
      grossInclVatMinor: (previous?.grossInclVatMinor ?? 0) + row.grossInclVatMinor,
      grossExclVatMinor: (previous?.grossExclVatMinor ?? 0) + row.grossExclVatMinor,
      netMinor: (previous?.netMinor ?? 0) + row.netMinor,
    });
  }
  return [...rows.values()].sort(
    (a, b) =>
      a.platform.localeCompare(b.platform) ||
      a.currency.localeCompare(b.currency) ||
      b.netMinor - a.netMinor ||
      sellerKey(a.seller).localeCompare(sellerKey(b.seller)),
  );
}

/**
 * The imported team as the base keeps it (ADR 0076), without asking the platform: each account linked in Impera, by
 * its platform id, with the member's name, and whether the platform removed it or no longer lists it (§ 5). The
 * platform's names and e-mails are never stored, so they are never here.
 */
export function teamImportLinkedOf(
  context: TeamImportContext,
  counts: Pick<TeamImportLinked, 'newCount' | 'removalCount' | 'abnormalRead'>,
  platform: TeamImportLinked['platform'],
): TeamImportLinked {
  const names = new Map(context.members.map((member) => [member.memberId, member.displayName]));
  const accounts = [...context.links.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([platformChatterId, link]): TeamImportLinked['accounts'][number] => {
      const review = context.reviews.get(platformChatterId);
      return {
        platformChatterId,
        link:
          link.kind === 'member'
            ? { kind: 'member', memberId: link.memberId, memberDisplayName: names.get(link.memberId) ?? '' }
            : { kind: 'agent' },
        removed: review !== undefined && (review.platformRemovedAt !== null || review.absentSince !== null),
      };
    });
  return { platform, accounts, ...counts };
}

/** A creator's register as the connectors' reads give it, before the shares are taken off. */
export interface CreatorSalesRead {
  readonly totals: SalesTotals;
  readonly readings: readonly SalesFeedReading[];
  /** Each team member's name by id, for the reading by chatter. */
  readonly names: ReadonlyMap<string, string>;
}

/** A range of days, both included (`YYYY-MM-DD`). */
export interface DayRange {
  readonly from: string;
  readonly to: string;
}

/**
 * The connectors' reads in the base, each in the reader's own `withTenantMember`: `null` when `readsCreatorFigures`
 * refuses him, checked in that transaction before anything else is read.
 */
export interface ConnectorReadsStore {
  sales(userId: string, creatorId: CreatorId, range: DayRange): Promise<CreatorSalesRead | null>;
  dailyStats(userId: string, creatorId: CreatorId, range: DayRange): Promise<PlatformDailyStatsDay[] | null>;
}

/** The longest period one read covers: a quarter and a few days, so that a call never reads the whole register. */
export const MAX_READ_DAYS = 93;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Days in order, both real dates, at most `MAX_READ_DAYS` of them, both included. */
export function readableRange(range: DayRange): boolean {
  if (!DAY.test(range.from) || !DAY.test(range.to)) return false;
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return false;
  if (new Date(from).toISOString().slice(0, 10) !== range.from) return false;
  if (new Date(to).toISOString().slice(0, 10) !== range.to) return false;
  return (to - from) / 86_400_000 + 1 <= MAX_READ_DAYS;
}
