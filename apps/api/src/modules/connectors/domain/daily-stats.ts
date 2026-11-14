import {
  calendarDayAt,
  type Platform,
  type PlatformChatterDailyStat,
  type PlatformDailyStat,
} from '@impera/contracts';

/**
 * The daily photo of a platform's statistics (ADR 0081), pure: which days an hourly reading asks, whether the
 * agency's quota still allows a call, and the rows kept of an answer. No amount is kept: the money stays in the
 * register (ADR 0081 § 2).
 */

/** The agency's calls to the statistics in one of the platform's days, all keys and readers together (Reveal). */
const STATS_CALLS_PER_DAY = 500;
/** What the reading leaves to the checks of CRM-02 and to the unexpected: it calls no more past this (§ 3). */
const STATS_CALLS_RESERVE = 100;
/** The local hour of the night reading of 31 days, in the platform's zone (§ 3). */
const FULL_READ_HOUR = 5;
/** One call reads at most this many days (`/v1/stats/daily`). */
const FULL_READ_DAYS = 31;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** `day` moved by `days` calendar days, `YYYY-MM-DD`. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The hour it is at `at` in `timeZone`, 0 to 23. */
export function hourAt(at: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(at)
    .find((part) => part.type === 'hour')?.value;
  return Number(hour);
}

export interface DailyStatsRange {
  readonly from: string;
  readonly to: string;
  /** The 31 days: once done, the next ones are today and yesterday until the next night. */
  readonly full: boolean;
}

/**
 * The days the hourly reading asks (§ 3): the last 31 at 5 h in the platform's zone, or while no reading of 31 days
 * went through since the key was verified (its connection, a reconnection); otherwise today and yesterday. A night
 * missed is caught up by the next hour, never read twice within the hour of 5 h.
 */
export function dailyStatsRange(
  now: Date,
  timeZone: string,
  state: { readonly fullReadAt: Date | null; readonly keyVerifiedAt: Date },
): DailyStatsRange {
  const today = calendarDayAt(now, timeZone);
  const { fullReadAt, keyVerifiedAt } = state;
  const never = fullReadAt === null || fullReadAt < keyVerifiedAt;
  const night =
    hourAt(now, timeZone) === FULL_READ_HOUR &&
    (fullReadAt === null || now.getTime() - fullReadAt.getTime() > HOUR_MS);
  if (never || night) return { from: addDays(today, 1 - FULL_READ_DAYS), to: today, full: true };
  return { from: addDays(today, -1), to: today, full: false };
}

/** Whether one more call to the statistics leaves the reserve whole (§ 3), from the calls already counted today. */
export function statsCallAllowed(callsToday: number): boolean {
  return callsToday < STATS_CALLS_PER_DAY - STATS_CALLS_RESERVE;
}

/** A model linked to a creator account (ADR 0050 § 3): only those are kept. */
export interface LinkedAccount {
  readonly platformAccountId: string;
  readonly creatorId: string;
}

/** A row of the photo: counters of a creator account's day, never an amount (§ 1, § 2). */
export interface DailyStatsRow {
  readonly platform: Platform;
  readonly platformAccountId: string;
  readonly creatorId: string;
  readonly day: string;
  readonly newSubscribers: number;
  readonly unsubscribes: number | null;
  readonly activeSubscribers: number;
  readonly renewals: number | null;
  readonly ppvSent: number | null;
  readonly ppvPurchased: number;
  readonly messagesSent: number | null;
  readonly messagesReceived: number | null;
}

/** The rows of an answer: a model with no link is left out, and comes in at the next 31 days once linked (§ 3). */
export function dailyStatsRows(
  platform: Platform,
  stats: readonly PlatformDailyStat[],
  links: ReadonlyMap<string, LinkedAccount>,
): DailyStatsRow[] {
  return stats.flatMap((stat) => {
    const link = links.get(stat.platformModelId);
    if (link === undefined) return [];
    return [
      {
        platform,
        platformAccountId: link.platformAccountId,
        creatorId: link.creatorId,
        day: stat.date,
        newSubscribers: stat.newSubscribers,
        unsubscribes: stat.unsubscribes,
        activeSubscribers: stat.activeSubscribers,
        renewals: stat.renewals,
        ppvSent: stat.ppvSent,
        ppvPurchased: stat.ppvPurchased,
        messagesSent: stat.messagesSent,
        messagesReceived: stat.messagesReceived,
      },
    ];
  });
}

/**
 * A row of the photo by chatter (ADR 0092 § 1): the counters of one member of the platform's team on a creator
 * account's day, never an amount.
 */
export interface ChatterStatsRow {
  readonly platform: Platform;
  readonly platformAccountId: string;
  readonly creatorId: string;
  readonly platformChatterId: string;
  readonly day: string;
  readonly ppvSent: number | null;
  readonly ppvPurchased: number;
  readonly messagesSent: number | null;
}

/**
 * The rows by chatter of an answer of `/v1/stats/chatters/daily`: a model with no link is left out as for the photo,
 * and so is the line of nobody (`platformChatterId` `null`, the sales no chatter made), which is no one's work.
 */
export function chatterStatsRows(
  platform: Platform,
  stats: readonly PlatformChatterDailyStat[],
  links: ReadonlyMap<string, LinkedAccount>,
): ChatterStatsRow[] {
  return stats.flatMap((stat) => {
    const link = links.get(stat.platformModelId);
    if (link === undefined || stat.platformChatterId === null) return [];
    return [
      {
        platform,
        platformAccountId: link.platformAccountId,
        creatorId: link.creatorId,
        platformChatterId: stat.platformChatterId,
        day: stat.date,
        ppvSent: stat.ppvSent,
        ppvPurchased: stat.ppvPurchased,
        messagesSent: stat.messagesSent,
      },
    ];
  });
}

/** The store of the photo and of the calls counted, through `withAdmin` (§ 5): the reading alone writes them. */
export interface DailyStatsStore {
  /** When the last reading of 31 days went through, `null` before the first. */
  fullReadAt(platform: Platform): Promise<Date | null>;
  /** The calls to the statistics counted on that day of the platform. */
  callsOn(platform: Platform, day: string): Promise<number>;
  /** Counts one call, before it is made; the day's total with it. */
  countCall(platform: Platform, day: string): Promise<number>;
  /** The models linked to a creator account still in the agency (an archived one is no longer read). */
  links(platform: Platform): Promise<ReadonlyMap<string, LinkedAccount>>;
  /** Writes each row over the one of its day (the platform's last word), and, after 31 days, the time of that read. */
  record(platform: Platform, rows: readonly DailyStatsRow[], readAt: Date, full: boolean): Promise<void>;
  /** Writes each row by chatter over the one of its day (ADR 0092 § 1), the platform's last word as for the photo. */
  recordChatters(rows: readonly ChatterStatsRow[], readAt: Date): Promise<void>;
}
