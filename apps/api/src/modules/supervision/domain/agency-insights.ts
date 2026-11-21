import {
  AGENCY_PERIOD_DAYS,
  AGENCY_TRANSFER_VAT_BPS,
  AgencySaleKindSchema,
  calendarDayAt,
  type AgencyFigures,
  type AgencyInsights,
  type AgencyPeriod,
  type AgencySaleKind,
  type AgencySpan,
  type AgencySpanQuery,
  type AgencySubscriberFigures,
  type AgencySubscribers,
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

/** The days a read covers and how they were chosen (ADR 0146): the period, its comparison, and the span said back. */
export interface AgencyRange {
  readonly from: string;
  readonly to: string;
  readonly previousFrom: string;
  readonly previousTo: string;
}

const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
const dayCount = (from: string, to: string): number => dayNumber(to) - dayNumber(from) + 1;
const minDay = (a: string, b: string): string => (a < b ? a : b);

/** The natural bounds of the day, week (Monday to Sunday) or calendar month holding `day`. */
export function periodAround(unit: 'day' | 'week' | 'month', day: string): { from: string; to: string } {
  if (unit === 'day') return { from: day, to: day };
  if (unit === 'week') {
    const isoDay = ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const from = shiftDay(day, 1 - isoDay);
    return { from, to: shiftDay(from, 6) };
  }
  const from = `${day.slice(0, 7)}-01`;
  const [year, month] = [Number(day.slice(0, 4)), Number(day.slice(5, 7))];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from, to: `${day.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}

/**
 * The days asked (ADR 0146 § 1 to § 3, § 6), in `timeZone`: a period running past today is read up to today and its
 * comparison cut at as many days; the comparison always ends before the period. Null when the comparison asked does
 * not (a refusal, never a guess). The older `period` keeps its rolling days (ADR 0078 § 3).
 */
export function agencySpan(
  query: AgencySpanQuery,
  now: Date,
  timeZone: string,
): { range: AgencyRange; span: AgencySpan } | null {
  const today = calendarDayAt(now, timeZone);
  if (query.kind === 'rolling') {
    const range = agencyRange(query.period, now, timeZone);
    return { range, span: { unit: 'rolling', partial: false, end: range.to, compare: 'previous', today } };
  }
  let natural: { from: string; to: string };
  let compare: { from: string; to: string };
  if (query.kind === 'custom') {
    natural = { from: minDay(query.from, today), to: query.to };
    const length = dayCount(natural.from, natural.to);
    const first = query.compareAt ?? shiftDay(natural.from, -length);
    compare = { from: first, to: shiftDay(first, length - 1) };
  } else {
    natural = periodAround(query.unit, minDay(query.at ?? today, today));
    compare =
      query.compareAt === undefined
        ? periodAround(query.unit, shiftDay(natural.from, -1))
        : periodAround(query.unit, query.compareAt);
  }
  if (compare.to >= natural.from) return null;
  const partial = natural.to > today;
  const to = partial ? today : natural.to;
  // A period cut at today is compared on as many days (§ 2), never past the comparison's own end.
  const previousTo = partial
    ? minDay(compare.to, shiftDay(compare.from, dayCount(natural.from, to) - 1))
    : compare.to;
  return {
    range: { from: natural.from, to, previousFrom: compare.from, previousTo },
    span: {
      unit: query.kind === 'custom' ? 'custom' : query.unit,
      partial,
      end: natural.to,
      compare: query.compareAt === undefined ? 'previous' : 'chosen',
      today,
    },
  };
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
interface HourSum {
  readonly isoDay: number;
  readonly hour: number;
  readonly saleType: SaleType;
  readonly currency: Currency;
  readonly grossMinor: number;
}

/**
 * What one fan spent in the period or the one before, in one currency: his sales of that period less their refunds,
 * whenever refunded (the register's rule: a refund comes off its sale). `key` never leaves the server.
 */
interface FanSum {
  readonly key: string;
  readonly currency: Currency;
  readonly grossMinor: number;
  /** The period before, not the period. */
  readonly previous: boolean;
  /** He bought before the period, in the register. */
  readonly seenBefore: boolean;
}

/**
 * One account's day in the snapshot of the platform's statistics (ADR 0081), as the connectors expose it: counts only,
 * null while the platform still computes one.
 */
export interface StatsDay {
  readonly platformAccountId: string;
  readonly day: string;
  readonly newSubscribers: number;
  readonly unsubscribes: number | null;
  readonly activeSubscribers: number;
  readonly renewals: number | null;
  readonly ppvSent: number | null;
  readonly ppvPurchased: number;
  readonly messagesSent: number | null;
  readonly messagesReceived: number | null;
  readonly readAt: Date;
}

/**
 * One refund the totals take off, as the connectors list it (ADR 0092 § 4): its sale's instant `null` when the sale
 * is not in the register.
 */
export interface RefundRead {
  readonly saleType: SaleType;
  readonly currency: Currency;
  readonly grossInclVatMinor: number;
  readonly refundedAt: Date;
  readonly saleOccurredAt: Date | null;
  readonly seller: SaleSeller;
}

/** One creator's part of the read, inside her tenant. */
export interface AgencyCreatorRead {
  readonly creatorId: CreatorId;
  readonly name: string;
  /** From the previous period's first day to today. */
  readonly totals: SalesTotals;
  readonly hours: readonly HourSum[];
  readonly fans: readonly FanSum[];
  /** The period's refunds one by one, the latest first (ADR 0092 § 4). */
  readonly refunds: readonly RefundRead[];
  /** Refunds of the period whose sale is older than the register: counted in no figure (CRM-02's note). */
  readonly refundsWithoutSale: number;
  /** The owner's revenue objective for the month read, in euro cents; null without one or off a calendar month. */
  readonly objectiveMinor: number | null;
  /** The day of her register's oldest line, in the platform's zone; null without one (ADR 0146 § 4). */
  readonly registerSince: string | null;
  /** Her accounts' days in the statistics' snapshot, from the day before the previous period to today. */
  readonly stats: readonly StatsDay[];
}

/** One hour of a day: its sums in euros and dollars, by creator and by kind. */
interface HourPots {
  all: [number, number];
  creator: Map<CreatorId, [number, number]>;
  kind: Map<AgencySaleKind, [number, number]>;
}

/** Signed sums kept apart by currency until the end, so each amount is converted once. */
interface Pot {
  revenue: [number, number];
  revenueExclVat: [number, number];
  net: [number, number];
  agency: [number, number];
  creator: [number, number];
  sales: [number, number];
  refunds: [number, number];
}

const pot = (): Pot => ({
  revenue: [0, 0],
  revenueExclVat: [0, 0],
  net: [0, 0],
  agency: [0, 0],
  creator: [0, 0],
  sales: [0, 0],
  refunds: [0, 0],
});

function add(into: Pot, row: SalesTotalsRow): void {
  const i = row.currency === 'USD' ? 1 : 0;
  into.revenue[i] += row.grossInclVatMinor;
  into.revenueExclVat[i] += row.grossExclVatMinor;
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

/**
 * The VAT the platform adds to a transfer of `agencyMinor` (ADR 0106 § 6): its rate, to the nearest cent, a half up;
 * nothing on a part at zero or below.
 */
export function agencyTransferVat(agencyMinor: number): number {
  if (agencyMinor <= 0) return 0;
  const scaled = agencyMinor * AGENCY_TRANSFER_VAT_BPS;
  const whole = Math.floor(scaled / 10_000);
  return scaled - whole * 10_000 >= 5_000 ? whole + 1 : whole;
}

function figuresOf(sums: Pot, rate: UsdRate | null): AgencyFigures {
  const money = ([eur, usd]: [number, number]): number => eur + toEur(usd, rate);
  const counted = ([eur, usd]: [number, number]): number => eur + (rate === null ? 0 : usd);
  const agencyMinor = money(sums.agency);
  return {
    revenueMinor: money(sums.revenue),
    revenueExclVatMinor: money(sums.revenueExclVat),
    netMinor: money(sums.net),
    agencyMinor,
    creatorMinor: money(sums.creator),
    agencyTransferVatMinor: agencyTransferVat(agencyMinor),
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

/**
 * Every creator's refunds one by one, the latest first (ADR 0092 § 4): the amount in euro cents (dollars converted
 * one by one, null without a rate), the seller named, the whole days from the sale. Never a fan.
 */
function refundListOf(
  creators: readonly AgencyCreatorRead[],
  names: ReadonlyMap<string, string>,
  rate: UsdRate | null,
): AgencyInsights['refundList'] {
  return creators
    .flatMap((creator) =>
      creator.refunds.map((refund) => ({
        refundedAt: refund.refundedAt,
        creatorId: creator.creatorId,
        kind: KIND_OF[refund.saleType],
        amountMinor:
          refund.currency === 'USD'
            ? rate === null
              ? null
              : usdToEurMinor(refund.grossInclVatMinor, rate.rateMicros)
            : refund.grossInclVatMinor,
        seller: named(refund.seller, names),
        delayDays:
          refund.saleOccurredAt === null
            ? null
            : Math.max(
                0,
                Math.floor((refund.refundedAt.getTime() - refund.saleOccurredAt.getTime()) / DAY_MS),
              ),
      })),
    )
    .sort((a, b) => b.refundedAt.getTime() - a.refundedAt.getTime())
    .map((refund) => ({ ...refund, refundedAt: refund.refundedAt.toISOString() }));
}

/** A revenue at this pace over `daysGone` days, carried to `days`, to the cent; null once the month is over. */
function projected(revenueMinor: number, daysGone: number, days: number): number | null {
  return daysGone >= days ? null : Math.round((revenueMinor * days) / daysGone);
}

/**
 * The month's objectives (ADR 0092 § 6): each creator counted, her objective, her revenue so far and its linear
 * projection; the agency's objective the sum of those set. `range` is the month read, up to today.
 */
export function objectivesOf(
  range: Pick<AgencyRange, 'from' | 'to'>,
  creators: readonly Pick<AgencyCreatorRead, 'creatorId' | 'objectiveMinor'>[],
  revenues: ReadonlyMap<CreatorId, number>,
): NonNullable<AgencyInsights['objectives']> {
  const daysGone = dayCount(range.from, range.to);
  const days = dayCount(range.from, periodAround('month', range.from).to);
  const rows = creators.map((creator) => {
    const revenueMinor = revenues.get(creator.creatorId) ?? 0;
    return {
      creatorId: creator.creatorId,
      objectiveMinor: creator.objectiveMinor,
      revenueMinor,
      projectedMinor: projected(revenueMinor, daysGone, days),
    };
  });
  const set = rows.filter((row) => row.objectiveMinor !== null);
  const revenueMinor = rows.reduce((sum, row) => sum + row.revenueMinor, 0);
  return {
    month: range.from,
    daysGone,
    days,
    creators: rows,
    objectiveMinor: set.length === 0 ? null : set.reduce((sum, row) => sum + (row.objectiveMinor ?? 0), 0),
    revenueMinor,
    projectedMinor: projected(revenueMinor, daysGone, days),
  };
}

/** The insights of `creators` over `range`, in euro cents; `names` maps a member id to his display name. */
export function agencyInsights(input: {
  /** The older form's period, null for a calendar's (ADR 0146 § 6). */
  readonly period: AgencyPeriod | null;
  readonly span: AgencySpan;
  readonly range: AgencyRange;
  readonly creators: readonly AgencyCreatorRead[];
  readonly names: ReadonlyMap<string, string>;
  readonly rate: UsdRate | null;
  /** The platform's zone, the days' and hours'. */
  readonly timeZone: string;
}): AgencyInsights {
  const { period, span, range, creators, names, rate, timeZone } = input;
  // One day read: its hours fill the chart (ADR 0078 § 4).
  const oneDay = range.from === range.to;
  const previousByDay = new Map<string, Pot>();
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
      if (!current) {
        const before = previousByDay.get(row.day) ?? pot();
        previousByDay.set(row.day, before);
        add(before, row);
        continue;
      }
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
  // One day's hours by creator and by kind, for the chart of a period of one day.
  const hourly = Array.from({ length: 24 }, (): HourPots => ({
    all: [0, 0],
    creator: new Map<CreatorId, [number, number]>(),
    kind: new Map<AgencySaleKind, [number, number]>(),
  }));
  for (const creator of creators) {
    for (const sum of creator.hours) {
      const cell = hours[sum.isoDay - 1]?.[sum.hour];
      if (cell === undefined) continue;
      const slot = sum.currency === 'USD' ? 1 : 0;
      cell[slot] += sum.grossMinor;
      if (sum.currency === 'USD' && sum.grossMinor !== 0) dollarsSeen = true;
      const hour = hourly[sum.hour];
      if (!oneDay || hour === undefined) continue;
      hour.all[slot] += sum.grossMinor;
      const ofCreator = hour.creator.get(creator.creatorId) ?? [0, 0];
      ofCreator[slot] += sum.grossMinor;
      hour.creator.set(creator.creatorId, ofCreator);
      const kind = KIND_OF[sum.saleType];
      const ofKind = hour.kind.get(kind) ?? [0, 0];
      ofKind[slot] += sum.grossMinor;
      hour.kind.set(kind, ofKind);
    }
  }

  // A fan is a fan of one creator's account: the reader's key already says whose, the creator is added in case two
  // creators' keys meet.
  const fans = new Map<string, { eur: number; usd: number; seenBefore: boolean }>();
  const before = new Map<string, { eur: number; usd: number }>();
  let refundsWithoutSale = 0;
  for (const creator of creators) {
    refundsWithoutSale += creator.refundsWithoutSale;
    for (const fan of creator.fans) {
      const key = `${creator.creatorId}:${fan.key}`;
      const entry = fan.previous
        ? (before.get(key) ?? { eur: 0, usd: 0 })
        : (fans.get(key) ?? { eur: 0, usd: 0, seenBefore: false });
      if (fan.currency === 'USD') {
        entry.usd += fan.grossMinor;
        if (fan.grossMinor !== 0) dollarsSeen = true;
      } else entry.eur += fan.grossMinor;
      if (fan.previous) before.set(key, entry);
      else {
        const seen = fans.get(key)?.seenBefore ?? false;
        fans.set(key, { eur: entry.eur, usd: entry.usd, seenBefore: seen || fan.seenBefore });
      }
    }
  }
  // A paying fan spent more than his refunds took back; without a rate, a fan who paid in dollars alone is in no
  // figure, as his sales are in none, in the period as in the one before.
  const pays = (fan: { eur: number; usd: number }): boolean =>
    rate === null ? fan.eur > 0 : fan.eur + toEur(fan.usd, rate) > 0;
  const spent = [...fans.values()]
    .filter(pays)
    .map((fan) => ({ amount: fan.eur + toEur(fan.usd, rate), seenBefore: fan.seenBefore }));
  const previousPaying = [...before.values()].filter(pays).length;
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

  const firstDays = creators
    .map((creator) => creator.registerSince)
    .filter((day): day is string => day !== null)
    .sort();
  return {
    period,
    span,
    ...range,
    registerSince: firstDays[0] ?? null,
    creators: creators.map((creator) => ({ creatorId: creator.creatorId, name: creator.name })),
    totals: { current: figuresOf(total.current, rate), previous: figuresOf(total.previous, rate) },
    days: daysBetween(range.from, range.to).map((day) => {
      const found = byDay.get(day);
      if (found === undefined)
        return { day, revenueMinor: 0, agencyMinor: 0, creatorMinor: 0, byCreator: [], byKind: [] };
      const all = figuresOf(found.all, rate);
      return {
        day,
        revenueMinor: all.revenueMinor,
        agencyMinor: all.agencyMinor,
        creatorMinor: all.creatorMinor,
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
    previousDays: daysBetween(range.previousFrom, range.previousTo).map((day) => ({
      day,
      revenueMinor: figuresOf(previousByDay.get(day) ?? pot(), rate).revenueMinor,
    })),
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
    hourly: oneDay
      ? hourly.map((hour, i) => ({
          hour: i,
          revenueMinor: hour.all[0] + toEur(hour.all[1], rate),
          byCreator: [...hour.creator]
            .map(([creatorId, [eur, usd]]) => ({ creatorId, revenueMinor: eur + toEur(usd, rate) }))
            .filter((one) => one.revenueMinor !== 0),
          byKind: AgencySaleKindSchema.options
            .map((kind) => {
              const [eur, usd] = hour.kind.get(kind) ?? [0, 0];
              return { kind, revenueMinor: eur + toEur(usd, rate) };
            })
            .filter((one) => one.revenueMinor !== 0),
        }))
      : [],
    fans: {
      paying: spent.length,
      previousPaying,
      newPaying: spent.filter((fan) => !fan.seenBefore).length,
      topTenShare: spentTotal > 0 ? Math.round((topTen / spentTotal) * 100) : null,
      averagePerPayingMinor: spent.length > 0 ? Math.round(spentTotal / spent.length) : null,
    },
    refundList: refundListOf(creators, names, rate),
    refundsWithoutSale,
    objectives:
      span.unit === 'month'
        ? objectivesOf(
            range,
            creators,
            new Map(creatorFigures.map((one) => [one.creatorId, one.revenueMinor] as const)),
          )
        : null,
    timeZone,
    dollarsLeftOut: rate === null && dollarsSeen,
    subscribers: subscribersOf(creators, range),
  };
}

/** The counts the platform computes later: null until it has. */
type Later = 'unsubscribes' | 'renewals' | 'ppvSent' | 'messagesSent' | 'messagesReceived';

/** One day summed over every account counted; absent when one of them has no line that day. */
interface StatsSum {
  readonly active: number;
  readonly newSubscribers: number;
  readonly ppvPurchased: number;
  readonly later: Readonly<Record<Later, number | null>>;
}

/**
 * Subscribers, PPV and messages of the creators counted (ADR 0081 § 4). A day counts only when every account seen in
 * the snapshot has its line that day: a day half read would look like a fall. A count the platform still computes on
 * one day leaves the period's sum null (« en calcul »), never a partial number. Null while the snapshot is empty.
 */
export function subscribersOf(
  creators: readonly Pick<AgencyCreatorRead, 'creatorId' | 'stats'>[],
  range: { from: string; to: string; previousFrom: string; previousTo: string },
): AgencySubscribers | null {
  const accounts = new Set<string>();
  const lines = new Map<string, StatsDay[]>();
  let readAt: Date | null = null;
  for (const creator of creators) {
    for (const line of creator.stats) {
      accounts.add(`${creator.creatorId}:${line.platformAccountId}`);
      const ofDay = lines.get(line.day) ?? [];
      ofDay.push(line);
      lines.set(line.day, ofDay);
      if (readAt === null || line.readAt > readAt) readAt = line.readAt;
    }
  }
  if (readAt === null) return null;
  const sumOf = (day: string): StatsSum | null => {
    const ofDay = lines.get(day) ?? [];
    if (ofDay.length < accounts.size) return null;
    const later = (field: Later): number | null =>
      ofDay.reduce<number | null>((total, line) => {
        const value = line[field];
        return total === null || value === null ? null : total + value;
      }, 0);
    return {
      active: ofDay.reduce((total, line) => total + line.activeSubscribers, 0),
      newSubscribers: ofDay.reduce((total, line) => total + line.newSubscribers, 0),
      ppvPurchased: ofDay.reduce((total, line) => total + line.ppvPurchased, 0),
      later: {
        unsubscribes: later('unsubscribes'),
        renewals: later('renewals'),
        ppvSent: later('ppvSent'),
        messagesSent: later('messagesSent'),
        messagesReceived: later('messagesReceived'),
      },
    };
  };
  const figures = (from: string, to: string): AgencySubscriberFigures => {
    const days = daysBetween(from, to);
    const read = days.map(sumOf).filter((one): one is StatsSum => one !== null);
    const laterSum = (field: Later): number | null =>
      read.reduce<number | null>((total, one) => {
        const value = one.later[field];
        return total === null || value === null ? null : total + value;
      }, 0);
    return {
      activeAtEnd: sumOf(to)?.active ?? null,
      activeBefore: sumOf(shiftDay(from, -1))?.active ?? null,
      newSubscribers: read.reduce((total, one) => total + one.newSubscribers, 0),
      unsubscribes: laterSum('unsubscribes'),
      renewals: laterSum('renewals'),
      ppvSent: laterSum('ppvSent'),
      ppvPurchased: read.reduce((total, one) => total + one.ppvPurchased, 0),
      messagesSent: laterSum('messagesSent'),
      messagesReceived: laterSum('messagesReceived'),
      daysRead: read.length,
      days: days.length,
    };
  };
  return {
    current: figures(range.from, range.to),
    previous: figures(range.previousFrom, range.previousTo),
    days: daysBetween(range.from, range.to).map((day) => ({ day, active: sumOf(day)?.active ?? null })),
    readAt: readAt.toISOString(),
  };
}

/** `day` moved by `days`, in calendar days. */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
