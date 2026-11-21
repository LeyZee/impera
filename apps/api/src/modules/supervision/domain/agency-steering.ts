import {
  STEERING_LAPSED_DAYS,
  STEERING_LAPSED_MAX,
  STEERING_PROFILE_MIN_DAYS,
  STEERING_PROFILE_MIN_SALES,
  STEERING_WINDOW_DAYS,
  type AgencySteering,
  type CreatorId,
  type Currency,
  type SteeringDaily,
  type SteeringDependency,
  type SteeringLapsed,
  type SteeringTraffic,
  type UserId,
} from '@impera/contracts';

import { daysBetween, shiftDay, subscribersOf, toEur, type StatsDay } from './agency-insights';
import type { UsdRate } from './fan-ranking';

/**
 * The agency's steering (ADR 0092, avenant du 21/11/2026): the day's objective, traffic to money, and how much the
 * revenue hangs on a few fans, on fixed windows. Pure: the reader gives what each creator's tenant holds.
 */

/** One day's sales of one currency: gross incl. VAT less the refunds of those sales, and how many. */
interface SteeringDaySum {
  readonly day: string;
  readonly currency: Currency;
  readonly grossMinor: number;
  readonly sales: number;
}

/** One hour of one past or present day, for the day's profile. */
interface SteeringHourSum {
  readonly day: string;
  readonly hour: number;
  readonly currency: Currency;
  readonly grossMinor: number;
}

/** One fan of the register in one currency: his spend and purchases, ever and in the windows. */
export interface SteeringFanRead {
  /** Account and fan id together: never leaves the server. */
  readonly key: string;
  readonly fanName: string | null;
  readonly conversationId: string | null;
  readonly currency: Currency;
  readonly firstDay: string;
  readonly lastDay: string;
  readonly lifetimeMinor: number;
  readonly windowMinor: number;
  readonly windowPurchases: number;
  readonly previousPurchases: number;
  /**
   * Never named among the lapsed (Sécurité, 21/11): an open care episode or an open doubt on his age on one of his
   * conversations. Charles's two rules come first, a lapsed payer's name invites a sale. His money still counts.
   */
  readonly withheld: boolean;
}

/** One creator's part of the read, inside her tenant. */
export interface SteeringCreatorRead {
  readonly creatorId: CreatorId;
  readonly name: string;
  readonly registerSince: string | null;
  /** The owner's objective for the current month; null without one. */
  readonly objectiveMinor: number | null;
  /** From the previous window's first day to today. */
  readonly days: readonly SteeringDaySum[];
  /** The profile's days (before today) and today. */
  readonly hours: readonly SteeringHourSum[];
  readonly fans: readonly SteeringFanRead[];
  /** Fans whose first message arrived in the window and in the one before; null when no conversation is read. */
  readonly wrote: { readonly current: number; readonly previous: number } | null;
  /** Her accounts' days in the statistics' snapshot, from the day before the previous window to today. */
  readonly stats: readonly StatsDay[];
}

/** What the steering reads of one creator: nothing out of the account's team scope, nothing before a register. */
export type SteeringCreatorAnswer =
  | { readonly kind: 'out_of_scope' }
  | { readonly kind: 'not_linked' }
  | { readonly kind: 'read'; readonly read: SteeringCreatorRead };

/** The port the infra's reader fills, one creator at a time in her tenant. */
export interface AgencySteeringReader {
  read(creatorId: CreatorId, userId: UserId, range: SteeringRange): Promise<SteeringCreatorAnswer>;
}

/** The steering's days: the window ending today, the one before, and the profile's. */
export interface SteeringRange {
  readonly today: string;
  readonly from: string;
  readonly previousFrom: string;
  readonly previousTo: string;
  /** The first day of the hourly profile: the 28 days before today. */
  readonly profileFrom: string;
  readonly monthFrom: string;
  readonly monthDays: number;
}

const STEERING_PROFILE_DAYS = 28;

export function steeringRange(today: string): SteeringRange {
  const from = shiftDay(today, -(STEERING_WINDOW_DAYS - 1));
  const monthFrom = `${today.slice(0, 7)}-01`;
  const next = new Date(Date.parse(`${monthFrom}T00:00:00Z`));
  next.setUTCMonth(next.getUTCMonth() + 1);
  const monthDays = Math.round((next.getTime() - Date.parse(`${monthFrom}T00:00:00Z`)) / 86_400_000);
  return {
    today,
    from,
    previousFrom: shiftDay(from, -STEERING_WINDOW_DAYS),
    previousTo: shiftDay(from, -1),
    profileFrom: shiftDay(today, -STEERING_PROFILE_DAYS),
    monthFrom,
    monthDays,
  };
}

const inEur = (minor: number, currency: Currency, rate: UsdRate | null): number =>
  currency === 'USD' ? toEur(minor, rate) : minor;

/** The day's objective, its revenue so far and its projection; `nowHour` is the hour of the day, minutes as a fraction. */
export function dailyOf(
  creators: readonly SteeringCreatorRead[],
  range: SteeringRange,
  rate: UsdRate | null,
  nowHour: number,
): SteeringDaily {
  const byDay = new Map<string, number>();
  for (const creator of creators) {
    for (const sum of creator.days) {
      byDay.set(sum.day, (byDay.get(sum.day) ?? 0) + inEur(sum.grossMinor, sum.currency, rate));
    }
  }
  const days = daysBetween(range.from, range.today).map((day) => ({
    day,
    revenueMinor: byDay.get(day) ?? 0,
  }));
  const todayMinor = byDay.get(range.today) ?? 0;
  const week = daysBetween(shiftDay(range.today, -7), shiftDay(range.today, -1));
  const averageMinor = Math.round(week.reduce((sum, day) => sum + (byDay.get(day) ?? 0), 0) / week.length);
  const set = creators.filter((creator) => creator.objectiveMinor !== null);
  const targetMinor =
    set.length === 0
      ? null
      : Math.round(set.reduce((sum, creator) => sum + (creator.objectiveMinor ?? 0), 0) / range.monthDays);
  return {
    targetMinor,
    todayMinor,
    projectedMinor: projectionOf(creators, range, rate, nowHour, todayMinor),
    days,
    averageMinor,
  };
}

/**
 * Today's revenue over the share the profile's days had made by this hour: none on fewer than 7 days of register, 30
 * sales in the profile, or before a tenth of a usual day is done (too early to say).
 */
function projectionOf(
  creators: readonly SteeringCreatorRead[],
  range: SteeringRange,
  rate: UsdRate | null,
  nowHour: number,
  todayMinor: number,
): number | null {
  const since = creators
    .map((creator) => creator.registerSince)
    .filter((day): day is string => day !== null)
    .sort()[0];
  if (since === undefined || daysBetween(since, range.today).length - 1 < STEERING_PROFILE_MIN_DAYS)
    return null;
  const profileEnd = shiftDay(range.today, -1);
  const sales = creators.reduce(
    (total, creator) =>
      total +
      creator.days
        .filter((sum) => sum.day >= range.profileFrom && sum.day <= profileEnd)
        .reduce((n, sum) => n + sum.sales, 0),
    0,
  );
  if (sales < STEERING_PROFILE_MIN_SALES) return null;
  let total = 0;
  let done = 0;
  const whole = Math.floor(nowHour);
  for (const creator of creators) {
    for (const sum of creator.hours) {
      if (sum.day < range.profileFrom || sum.day > profileEnd) continue;
      const eur = inEur(sum.grossMinor, sum.currency, rate);
      total += eur;
      if (sum.hour < whole) done += eur;
      else if (sum.hour === whole) done += eur * (nowHour - whole);
    }
  }
  if (total <= 0) return null;
  const share = done / total;
  if (share < 0.1) return null;
  return Math.max(todayMinor, Math.round(todayMinor / Math.min(1, share)));
}

/** A fan's sums brought to euros and merged across currencies. */
interface FanEur {
  readonly creatorId: CreatorId;
  readonly fan: SteeringFanRead;
  lifetime: number;
  window: number;
  windowPurchases: number;
  previousPurchases: number;
  firstDay: string;
  lastDay: string;
}

function fansInEur(creators: readonly SteeringCreatorRead[], rate: UsdRate | null): FanEur[] {
  const byKey = new Map<string, FanEur>();
  for (const creator of creators) {
    for (const fan of creator.fans) {
      // A fan paid in dollars alone counts in no figure without a rate, as his sales count in none.
      if (fan.currency === 'USD' && rate === null) continue;
      const key = `${creator.creatorId}:${fan.key}`;
      const known = byKey.get(key);
      const into: FanEur = known ?? {
        creatorId: creator.creatorId,
        fan,
        lifetime: 0,
        window: 0,
        windowPurchases: 0,
        previousPurchases: 0,
        firstDay: fan.firstDay,
        lastDay: fan.lastDay,
      };
      into.lifetime += inEur(fan.lifetimeMinor, fan.currency, rate);
      into.window += inEur(fan.windowMinor, fan.currency, rate);
      into.windowPurchases += fan.windowPurchases;
      into.previousPurchases += fan.previousPurchases;
      if (fan.firstDay < into.firstDay) into.firstDay = fan.firstDay;
      if (fan.lastDay > into.lastDay) into.lastDay = fan.lastDay;
      byKey.set(key, into);
    }
  }
  return [...byKey.values()];
}

/** Traffic to money over the window and the one before. */
export function trafficOf(
  creators: readonly SteeringCreatorRead[],
  range: SteeringRange,
  rate: UsdRate | null,
): SteeringTraffic {
  const fans = fansInEur(creators, rate);
  const subscribers = subscribersOf(creators, {
    from: range.from,
    to: range.today,
    previousFrom: range.previousFrom,
    previousTo: range.previousTo,
  });
  const newSubscribers = (side: 'current' | 'previous'): number | null => {
    const figures = subscribers?.[side];
    return figures === undefined || figures.daysRead === 0 ? null : figures.newSubscribers;
  };
  const reading = creators.map((creator) => creator.wrote).filter((one) => one !== null);
  const wrote = (side: 'current' | 'previous'): number | null =>
    reading.length === 0 ? null : reading.reduce((sum, one) => sum + one[side], 0);
  const firstIn = (from: string, to: string): FanEur[] =>
    fans.filter((fan) => fan.firstDay >= from && fan.firstDay <= to);
  const current = firstIn(range.from, range.today);
  const previous = firstIn(range.previousFrom, range.previousTo);
  return {
    newSubscribers: newSubscribers('current'),
    wrote: wrote('current'),
    firstPurchase: current.length,
    regular: current.filter((fan) => fan.windowPurchases >= 2).length,
    previous: {
      newSubscribers: newSubscribers('previous'),
      wrote: wrote('previous'),
      firstPurchase: previous.length,
      regular: previous.filter((fan) => fan.previousPurchases >= 2).length,
    },
  };
}

/** How the window's revenue spreads over its paying fans, and the payers who stopped (ADR 0092 § 3). */
export function dependencyOf(
  creators: readonly SteeringCreatorRead[],
  range: SteeringRange,
  rate: UsdRate | null,
): SteeringDependency {
  const fans = fansInEur(creators, rate);
  const paying = fans
    .filter((fan) => fan.window > 0)
    .map((fan) => fan.window)
    .sort((a, b) => b - a);
  const totalMinor = paying.reduce((sum, one) => sum + one, 0);
  const topOneMinor = paying[0] ?? 0;
  const nextFourMinor = paying.slice(1, 5).reduce((sum, one) => sum + one, 0);
  let fansForEighty = 0;
  let reached = 0;
  for (const one of paying) {
    if (reached >= totalMinor * 0.8) break;
    reached += one;
    fansForEighty += 1;
  }
  const lapsedBefore = shiftDay(range.today, -STEERING_LAPSED_DAYS);
  const lapsed: SteeringLapsed[] = fans
    .filter(
      (fan) =>
        fan.lifetime > 0 && fan.lastDay <= lapsedBefore && fan.fan.fanName !== null && !fan.fan.withheld,
    )
    .sort((a, b) => b.lifetime - a.lifetime || a.lastDay.localeCompare(b.lastDay))
    .slice(0, STEERING_LAPSED_MAX)
    .map((fan) => ({
      creatorId: fan.creatorId,
      fanName: fan.fan.fanName ?? '',
      spentMinor: fan.lifetime,
      lastPurchaseDay: fan.lastDay,
      daysSince: daysBetween(fan.lastDay, range.today).length - 1,
      conversationId: fan.fan.conversationId,
    }));
  const sales = creators.reduce(
    (total, creator) =>
      total +
      creator.days
        .filter((sum) => sum.day >= range.from && sum.day <= range.today)
        .reduce((n, sum) => n + sum.sales, 0),
    0,
  );
  return {
    payingFans: paying.length,
    sales,
    totalMinor,
    topOneMinor,
    nextFourMinor,
    restMinor: totalMinor - topOneMinor - nextFourMinor,
    fansForEighty,
    medianMinor: medianOf(paying),
    lapsed,
  };
}

function medianOf(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  const high = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return high;
  return Math.round(((sorted[middle - 1] ?? 0) + high) / 2);
}

export function agencySteering(input: {
  readonly creators: readonly SteeringCreatorRead[];
  readonly range: SteeringRange;
  readonly rate: UsdRate | null;
  readonly timeZone: string;
  readonly nowHour: number;
}): AgencySteering {
  const { creators, range, rate } = input;
  const since = creators
    .map((creator) => creator.registerSince)
    .filter((day): day is string => day !== null)
    .sort()[0];
  const dollarsSeen =
    creators.some((creator) => creator.days.some((sum) => sum.currency === 'USD')) ||
    creators.some((creator) => creator.fans.some((fan) => fan.currency === 'USD'));
  return {
    today: range.today,
    timeZone: input.timeZone,
    creators: creators.map((creator) => ({ creatorId: creator.creatorId, name: creator.name })),
    registerSince: since ?? null,
    dollarsLeftOut: rate === null && dollarsSeen,
    daily: dailyOf(creators, range, rate, input.nowHour),
    traffic: trafficOf(creators, range, rate),
    dependency: dependencyOf(creators, range, rate),
  };
}
