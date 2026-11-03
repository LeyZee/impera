import {
  calendarDayAt,
  type DashboardPeriod,
  type DashboardRevealSales,
  type DashboardSalesFigures,
  type DashboardSalesSeller,
  type SaleSeller,
  type SalesTotals,
  type SalesTotalsRow,
} from '@nirvana/contracts';

import { usdToEurMinor, type UsdRate } from './fan-ranking';

/**
 * The Dashboard's panel of the sales read in a platform's register (CRM-04 lot c): the platform's own amounts as
 * `salesTotals` summed them, never computed again (ADR 0050 § 8), by seller for the owner and an active manager only
 * (ADR 0043 § 7). Pure.
 */

/** A row's figures in one currency, before any conversion. */
interface Sums {
  sales: number;
  refunds: number;
  revenue: number;
  net: number;
  agency: number;
  creator: number;
}

const ZERO: Readonly<Sums> = { sales: 0, refunds: 0, revenue: 0, net: 0, agency: 0, creator: 0 };

function add(sums: Sums, row: SalesTotalsRow): Sums {
  return {
    sales: sums.sales + row.sales,
    refunds: sums.refunds + row.refunds,
    revenue: sums.revenue + row.grossInclVatMinor,
    net: sums.net + row.netMinor,
    agency: sums.agency + row.agencyMinor,
    creator: sums.creator + row.creatorMinor,
  };
}

/**
 * A signed dollar sum in euro cents, at pay's rounding (`usdToEurMinor`): the magnitude converted, its sign kept, so
 * that a refund converts as its sale does.
 */
function signedUsdToEur(usdMinor: number, rate: UsdRate): number {
  const magnitude = usdToEurMinor(Math.abs(usdMinor), rate.rateMicros);
  return usdMinor < 0 ? -magnitude : magnitude;
}

/**
 * One seller's figures in euro cents: euros as they are, dollars converted once on the seller's period total (each
 * amount rounded once, as `rankFans` does), left out without a rate. The counts are the sales the figures hold.
 */
function inEuros(eur: Sums, usd: Sums, rate: UsdRate | null): DashboardSalesFigures {
  const convert = (amount: number): number => (rate === null ? 0 : signedUsdToEur(amount, rate));
  const counted = rate === null ? ZERO : usd;
  return {
    sales: eur.sales + counted.sales,
    refunds: eur.refunds + counted.refunds,
    revenueMinor: eur.revenue + convert(usd.revenue),
    netMinor: eur.net + convert(usd.net),
    agencyMinor: eur.agency + convert(usd.agency),
    creatorMinor: eur.creator + convert(usd.creator),
  };
}

function sellerKey(seller: SaleSeller): string {
  return seller.kind === 'member' ? `member:${seller.memberId}` : seller.kind;
}

/** A member whose name the reader could not read (gone from the team table): never an empty label. */
const UNKNOWN_MEMBER = 'Membre inconnu';

/** The order of the sellers that are not members, after them at equal revenue: the agent, unlinked, nobody. */
function nameOf(names: ReadonlyMap<string, string> | null, memberId: string): string {
  const name = names?.get(memberId)?.trim() ?? '';
  return name === '' ? UNKNOWN_MEMBER : name;
}

const KIND_ORDER: Readonly<Record<DashboardSalesSeller['kind'], number>> = {
  member: 0,
  agent: 1,
  unlinked: 2,
  none: 3,
};

function totalOf(rows: readonly DashboardSalesFigures[]): DashboardSalesFigures {
  return rows.reduce<DashboardSalesFigures>(
    (sum, row) => ({
      sales: sum.sales + row.sales,
      refunds: sum.refunds + row.refunds,
      revenueMinor: sum.revenueMinor + row.revenueMinor,
      netMinor: sum.netMinor + row.netMinor,
      agencyMinor: sum.agencyMinor + row.agencyMinor,
      creatorMinor: sum.creatorMinor + row.creatorMinor,
    }),
    { sales: 0, refunds: 0, revenueMinor: 0, netMinor: 0, agencyMinor: 0, creatorMinor: 0 },
  );
}

/**
 * The panel of `totals`: its figures in euro cents, and by seller when `names` is given (the owner's or an active
 * manager's read, member id to display name), `null` otherwise. The whole is the sum of the sellers' figures, so the
 * two never disagree by a cent of conversion. A seller with neither a sale nor a refund in the period is left out.
 */
export function revealSalesPanel(input: {
  readonly totals: SalesTotals;
  readonly rate: UsdRate | null;
  readonly names: ReadonlyMap<string, string> | null;
}): DashboardRevealSales {
  const { totals, rate, names } = input;
  const bySeller = new Map<string, { seller: SaleSeller; eur: Sums; usd: Sums }>();
  for (const row of totals.rows) {
    const key = sellerKey(row.seller);
    const entry = bySeller.get(key) ?? { seller: row.seller, eur: { ...ZERO }, usd: { ...ZERO } };
    if (row.currency === 'USD') entry.usd = add(entry.usd, row);
    else entry.eur = add(entry.eur, row);
    bySeller.set(key, entry);
  }
  const sellers = [...bySeller.values()]
    .map(({ seller, eur, usd }) => ({ seller, figures: inEuros(eur, usd, rate) }))
    .filter(({ figures }) => figures.sales > 0 || figures.refunds > 0);
  const named = sellers
    .map(({ seller, figures }) => ({
      ...figures,
      seller:
        seller.kind === 'member'
          ? { kind: 'member' as const, memberId: seller.memberId, name: nameOf(names, seller.memberId) }
          : seller,
    }))
    .sort(
      (a, b) =>
        b.revenueMinor - a.revenueMinor ||
        KIND_ORDER[a.seller.kind] - KIND_ORDER[b.seller.kind] ||
        (a.seller.kind === 'member' && b.seller.kind === 'member'
          ? a.seller.name.localeCompare(b.seller.name, 'fr')
          : 0),
    );
  return {
    from: totals.from,
    to: totals.to,
    totals: totalOf(sellers.map(({ figures }) => figures)),
    bySeller: names === null ? null : named,
    usd: {
      seen: totals.rows.some((row) => row.currency === 'USD' && (row.sales > 0 || row.refunds > 0)),
      rate: rate === null ? null : { day: rate.day },
    },
    refundsWithoutSale: totals.refundsWithoutSale,
  };
}

const DAY_MS = 86_400_000;

/** Days before today the period reaches back: the same reach as the rest of the Dashboard (today, 7 days, 30 days). */
const DAYS_BACK: Readonly<Record<DashboardPeriod, number>> = { day: 0, week: 6, month: 29 };

/**
 * The days of the panel for `period`, both included, in her time zone: today, the last 7 days or the last 30, today
 * counted, as the period control says. Each line falls on its sale's day in the platform's zone (`salesTotals`).
 */
export function salesDays(
  period: DashboardPeriod,
  now: Date,
  timeZone: string,
): { readonly from: string; readonly to: string } {
  const to = calendarDayAt(now, timeZone);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - DAYS_BACK[period] * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}
