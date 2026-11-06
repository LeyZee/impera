import {
  AGENCY_PERIOD_DAYS,
  AgencySaleKindSchema,
  calendarDayAt,
  type AgencyFigures,
  type AgencyInsights,
  type AgencyPeriod,
  type AgencySaleKind,
  type CreatorId,
  type Currency,
  type DashboardSalesSeller,
  type SaleSeller,
  type SaleType,
  type SalesTotals,
  type SalesTotalsRow,
} from '@impera/contracts';

import { usdToEurMinor, type UsdRate } from './fan-ranking';

/**
 * The agency's insights (ADR 0078): the registers' totals of each creator counted, as `salesTotals` summed them (never
 * summed again from the lines), plus the hours their sales fell in and what their paying fans spent, all brought to
 * euro cents. Pure: the reader gives what each creator's tenant holds, the screen receives no fan.
 */

const DAY_MS = 86_400_000;

/** The days of `period` and of the period of the same length just before, today counted, in `timeZone`. */
export function agencyRange(
  period: AgencyPeriod,
  now: Date,
  timeZone: string,
): { from: string; to: string; previousFrom: string; previousTo: string } {
  const to = calendarDayAt(now, timeZone);
  const length = AGENCY_PERIOD_DAYS[period];
  const shift = (day: string, days: number): string =>
    new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
  const from = shift(to, -(length - 1));
  return { from, to, previousFrom: shift(from, -length), previousTo: shift(from, -1) };
}

/** The days from `from` to `to`, both included. */
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += DAY_MS) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}

const KIND_OF: Readonly<Record<SaleType, AgencySaleKind>> = {
  subscription: 'subscriptions',
  renewal: 'subscriptions',
  ppv: 'ppv',
  mass_dm: 'mass_dm',
  tip: 'tips',
  payment_link: 'payment_links',
  boudoir: 'boudoir',
  paid_message: 'paid_messages',
  other: 'other',
};

/** The hours of a creator's sales: ISO day of the week (1 Monday … 7 Sunday) and hour, in the platform's zone. */
export interface HourSum {
  readonly isoDay: number;
  readonly hour: number;
  readonly currency: Currency;
  readonly grossMinor: number;
}

/** What one paying fan of the period spent (sales only), in one currency; `key` never leaves the server. */
export interface FanSum {
  readonly key: string;
  readonly currency: Currency;
  readonly grossMinor: number;
  /** He bought before the period, in the register. */
  readonly seenBefore: boolean;
}

/** One creator's part of the read, inside her tenant. */
export interface AgencyCreatorRead {
  readonly creatorId: CreatorId;
  readonly name: string;
  /** From the previous period's first day to today. */
  readonly totals: SalesTotals;
  readonly hours: readonly HourSum[];
  readonly fans: readonly FanSum[];
  readonly previousPaying: number;
}

/** Signed sums kept apart by currency until the end, so each amount is converted once. */
interface Pot {
  revenue: [number, number];
  net: [number, number];
  agency: [number, number];
  creator: [number, number];
  sales: [number, number];
  refunds: [number, number];
}

const pot = (): Pot => ({
  revenue: [0, 0],
  net: [0, 0],
  agency: [0, 0],
  creator: [0, 0],
  sales: [0, 0],
  refunds: [0, 0],
});

function add(into: Pot, row: SalesTotalsRow): void {
  const i = row.currency === 'USD' ? 1 : 0;
  into.revenue[i] += row.grossInclVatMinor;
  into.net[i] += row.netMinor;
  into.agency[i] += row.agencyMinor;
  into.creator[i] += row.creatorMinor;
  into.sales[i] += row.sales;
  into.refunds[i] += row.refunds;
}

/** A signed dollar sum in euro cents, its magnitude converted at pay's rounding, its sign kept. */
function toEur(usdMinor: number, rate: UsdRate | null): number {
  if (rate === null || usdMinor === 0) return 0;
  const magnitude = usdToEurMinor(Math.abs(usdMinor), rate.rateMicros);
  return usdMinor < 0 ? -magnitude : magnitude;
}

function figuresOf(sums: Pot, rate: UsdRate | null): AgencyFigures {
  const money = ([eur, usd]: [number, number]): number => eur + toEur(usd, rate);
  const counted = ([eur, usd]: [number, number]): number => eur + (rate === null ? 0 : usd);
  return {
    revenueMinor: money(sums.revenue),
    netMinor: money(sums.net),
    agencyMinor: money(sums.agency),
    creatorMinor: money(sums.creator),
    sales: counted(sums.sales),
    refunds: counted(sums.refunds),
  };
}

function sellerKey(seller: SaleSeller): string {
  return seller.kind === 'member' ? `member:${seller.memberId}` : seller.kind;
}

/** The order of the sellers that are not members, after them at equal revenue. */
const SELLER_ORDER: Readonly<Record<DashboardSalesSeller['kind'], number>> = {
  member: 0,
  agent: 1,
  unlinked: 2,
  none: 3,
};

/** A member whose name the reader could not read: never an empty label. */
const UNKNOWN_MEMBER = 'Membre inconnu';

function named(seller: SaleSeller, names: ReadonlyMap<string, string>): DashboardSalesSeller {
  if (seller.kind !== 'member') return seller;
  const name = names.get(seller.memberId)?.trim() ?? '';
  return { kind: 'member', memberId: seller.memberId, name: name === '' ? UNKNOWN_MEMBER : name };
}

/** One bucket's sums for the period and the one before. */
interface Pair {
  current: Pot;
  previous: Pot;
}

function pairIn<K>(map: Map<K, Pair>, key: K): Pair {
  const found = map.get(key);
  if (found !== undefined) return found;
  const made = { current: pot(), previous: pot() };
  map.set(key, made);
  return made;
}

const hasAny = (figures: AgencyFigures): boolean =>
  figures.sales > 0 || figures.refunds > 0 || figures.revenueMinor !== 0;

/** The insights of `creators` over `range`, in euro cents; `names` maps a member id to his display name. */
export function agencyInsights(input: {
  readonly period: AgencyPeriod;
  readonly range: { from: string; to: string; previousFrom: string; previousTo: string };
  readonly creators: readonly AgencyCreatorRead[];
  readonly names: ReadonlyMap<string, string>;
  readonly rate: UsdRate | null;
}): AgencyInsights {
  const { period, range, creators, names, rate } = input;
  const total: Pair = { current: pot(), previous: pot() };
  const byDay = new Map<string, { all: Pot; creator: Map<CreatorId, Pot>; kind: Map<AgencySaleKind, Pot> }>();
  const byKind = new Map<AgencySaleKind, Pair>();
  const bySeller = new Map<string, Pair & { seller: SaleSeller }>();
  const byCreator = new Map<CreatorId, Pair>();
  let dollarsSeen = false;

  for (const creator of creators) {
    const mine = pairIn(byCreator, creator.creatorId);
    for (const row of creator.totals.rows) {
      const current = row.day >= range.from && row.day <= range.to;
      const previous = row.day >= range.previousFrom && row.day <= range.previousTo;
      if (!current && !previous) continue;
      if (current && row.currency === 'USD') dollarsSeen = true;
      const side = current ? 'current' : 'previous';
      add(total[side], row);
      add(mine[side], row);
      add(pairIn(byKind, KIND_OF[row.saleType])[side], row);
      const key = sellerKey(row.seller);
      const seller = bySeller.get(key) ?? { seller: row.seller, current: pot(), previous: pot() };
      bySeller.set(key, seller);
      add(seller[side], row);
      if (!current) continue;
      const day = byDay.get(row.day) ?? {
        all: pot(),
        creator: new Map<CreatorId, Pot>(),
        kind: new Map<AgencySaleKind, Pot>(),
      };
      byDay.set(row.day, day);
      add(day.all, row);
      const ofCreator = day.creator.get(creator.creatorId) ?? pot();
      day.creator.set(creator.creatorId, ofCreator);
      add(ofCreator, row);
      const kind = KIND_OF[row.saleType];
      const ofKind = day.kind.get(kind) ?? pot();
      day.kind.set(kind, ofKind);
      add(ofKind, row);
    }
  }

  const hours = Array.from({ length: 7 }, () => Array.from({ length: 24 }, (): [number, number] => [0, 0]));
  for (const creator of creators) {
    for (const sum of creator.hours) {
      const cell = hours[sum.isoDay - 1]?.[sum.hour];
      if (cell === undefined) continue;
      cell[sum.currency === 'USD' ? 1 : 0] += sum.grossMinor;
      if (sum.currency === 'USD' && sum.grossMinor !== 0) dollarsSeen = true;
    }
  }

  // A fan is a fan of one creator's account: the reader's key already says whose, the creator is added in case two
  // creators' keys meet.
  const fans = new Map<string, { eur: number; usd: number; seenBefore: boolean }>();
  let previousPaying = 0;
  for (const creator of creators) {
    previousPaying += creator.previousPaying;
    for (const fan of creator.fans) {
      const key = `${creator.creatorId}:${fan.key}`;
      const entry = fans.get(key) ?? { eur: 0, usd: 0, seenBefore: false };
      if (fan.currency === 'USD') {
        entry.usd += fan.grossMinor;
        if (fan.grossMinor !== 0) dollarsSeen = true;
      } else entry.eur += fan.grossMinor;
      entry.seenBefore ||= fan.seenBefore;
      fans.set(key, entry);
    }
  }
  // Without a rate, a fan who paid in dollars alone is in no figure, as his sales are in none.
  const spent = [...fans.values()]
    .filter((fan) => fan.eur > 0 || (rate !== null && fan.usd > 0))
    .map((fan) => ({ amount: fan.eur + toEur(fan.usd, rate), seenBefore: fan.seenBefore }));
  const spentTotal = spent.reduce((sum, fan) => sum + fan.amount, 0);
  const topTen = [...spent]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .reduce((sum, fan) => sum + fan.amount, 0);

  const creatorNames = new Map(creators.map((creator) => [creator.creatorId, creator.name] as const));
  const creatorFigures = [...byCreator.entries()]
    .map(([creatorId, pair]) => ({
      creatorId,
      ...figuresOf(pair.current, rate),
      previousRevenueMinor: figuresOf(pair.previous, rate).revenueMinor,
    }))
    .sort(
      (a, b) =>
        b.revenueMinor - a.revenueMinor ||
        (creatorNames.get(a.creatorId) ?? '').localeCompare(creatorNames.get(b.creatorId) ?? '', 'fr'),
    );

  return {
    period,
    ...range,
    creators: creators.map((creator) => ({ creatorId: creator.creatorId, name: creator.name })),
    totals: { current: figuresOf(total.current, rate), previous: figuresOf(total.previous, rate) },
    days: daysBetween(range.from, range.to).map((day) => {
      const found = byDay.get(day);
      if (found === undefined) return { day, revenueMinor: 0, byCreator: [], byKind: [] };
      return {
        day,
        revenueMinor: figuresOf(found.all, rate).revenueMinor,
        byCreator: creators
          .map((creator) => ({
            creatorId: creator.creatorId,
            revenueMinor: figuresOf(found.creator.get(creator.creatorId) ?? pot(), rate).revenueMinor,
          }))
          .filter((one) => one.revenueMinor !== 0),
        byKind: AgencySaleKindSchema.options
          .map((kind) => ({
            kind,
            revenueMinor: figuresOf(found.kind.get(kind) ?? pot(), rate).revenueMinor,
          }))
          .filter((one) => one.revenueMinor !== 0),
      };
    }),
    kinds: AgencySaleKindSchema.options.flatMap((kind) => {
      const pair = byKind.get(kind);
      if (pair === undefined) return [];
      const current = figuresOf(pair.current, rate);
      const previous = figuresOf(pair.previous, rate);
      if (!hasAny(current) && !hasAny(previous)) return [];
      return [
        {
          kind,
          revenueMinor: current.revenueMinor,
          sales: current.sales,
          previousRevenueMinor: previous.revenueMinor,
        },
      ];
    }),
    sellers: [...bySeller.values()]
      .map((entry) => ({
        seller: named(entry.seller, names),
        ...figuresOf(entry.current, rate),
        previousRevenueMinor: figuresOf(entry.previous, rate).revenueMinor,
      }))
      .filter((entry) => entry.sales > 0 || entry.refunds > 0)
      .sort(
        (a, b) =>
          b.revenueMinor - a.revenueMinor ||
          SELLER_ORDER[a.seller.kind] - SELLER_ORDER[b.seller.kind] ||
          (a.seller.kind === 'member' && b.seller.kind === 'member'
            ? a.seller.name.localeCompare(b.seller.name, 'fr')
            : 0),
      ),
    byCreator: creatorFigures,
    hours: hours.map((row) => row.map(([eur, usd]) => eur + toEur(usd, rate))),
    fans: {
      paying: spent.length,
      previousPaying,
      newPaying: spent.filter((fan) => !fan.seenBefore).length,
      topTenShare: spentTotal > 0 ? Math.round((topTen / spentTotal) * 100) : null,
      averagePerPayingMinor: spent.length > 0 ? Math.round(spentTotal / spent.length) : null,
    },
    dollarsLeftOut: rate === null && dollarsSeen,
  };
}
