import type { NotificationReason } from '@impera/contracts';

/**
 * When a push notification may ring (ADR 0042 § 7, CR-01), pure. The rules live here, never in a setting nor in a
 * prompt:
 * - heures calmes, chosen by each account (22 h – 8 h by default): nothing rings; what was held waits for a single
 *   recap at their end. The start of one's own shift and the first reminder of its report (ADR 0077) are the only
 *   exceptions (glossary, « Heures calmes »), and neither counts in the cap;
 * - a sale rings, one notification per sale, grouped only in a burst (more than 3 within 2 minutes);
 * - everything else (reminders, routine, streak, team) shares a daily cap, in the account's own day; past it, the
 *   notification stays in the app and does not ring.
 */

/** A span of the local day, in minutes after midnight; it crosses midnight when it ends before it starts. */
export interface QuietHours {
  readonly startMinute: number;
  readonly endMinute: number;
}

export const DEFAULT_QUIET_HOURS: QuietHours = { startMinute: 22 * 60, endMinute: 8 * 60 };

/** Notifications other than sales and one's own shift start and end, per account and per local day. */
export const DEFAULT_DAILY_CAP = 6;

/** More sales than this within 2 minutes (the caller's count) ring as one grouped notification. */
const SALE_BURST_SIZE = 3;

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

/** Quiet hours whose start equals their end hold nothing (the person turned them off). */
function quietHoursOff(quiet: QuietHours): boolean {
  return quiet.startMinute === quiet.endMinute;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const known = formatters.get(timeZone);
  if (known !== undefined) return known;
  const made = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  formatters.set(timeZone, made);
  return made;
}

/** The local day (`YYYY-MM-DD`) and minute of the day at `at` in `timeZone`. */
export function localClock(at: Date, timeZone: string): { readonly day: string; readonly minute: number } {
  const parts = formatterFor(timeZone).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Whether a local minute of the day falls in the quiet hours (start included, end excluded). */
export function inQuietHours(minute: number, quiet: QuietHours): boolean {
  if (quietHoursOff(quiet)) return false;
  return quiet.startMinute < quiet.endMinute
    ? minute >= quiet.startMinute && minute < quiet.endMinute
    : minute >= quiet.startMinute || minute < quiet.endMinute;
}

/**
 * The first instant after `at` when the quiet hours are over, or null when `at` is not in them. Walked minute by
 * minute in the zone, so a change of time inside the quiet hours (the last Sunday of March or October) ends them at
 * the right wall-clock minute.
 */
export function quietHoursEnd(at: Date, timeZone: string, quiet: QuietHours): Date | null {
  if (!inQuietHours(localClock(at, timeZone).minute, quiet)) return null;
  let cursor = Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS;
  // Quiet hours last less than a day, plus an hour for a change of time.
  for (let step = 0; step <= DAY_MINUTES + 60; step += 1) {
    cursor += MINUTE_MS;
    if (!inQuietHours(localClock(new Date(cursor), timeZone).minute, quiet)) return new Date(cursor);
  }
  return null;
}

export interface NotificationContext {
  readonly kind: NotificationReason;
  readonly at: Date;
  readonly timeZone: string;
  readonly quiet: QuietHours;
  readonly dailyCap: number;
  /** Notifications of capped kinds already rung today, in the account's day. */
  readonly cappedRungToday: number;
  /** Sales already rung for this account within the 2 minutes before `at`. */
  readonly salesInBurstWindow: number;
}

export type NotificationDecision =
  /** It rings now. */
  | { readonly action: 'ring' }
  /** It waits for the recap at the end of the quiet hours. */
  | { readonly action: 'hold'; readonly until: Date }
  /** A sale in a burst: added to the grouped notification of the window. */
  | { readonly action: 'group' }
  /** Over the daily cap: it stays in the app, silent. */
  | { readonly action: 'silent' };

/**
 * What rings even in the quiet hours, outside the daily cap: one's own shift that starts, and the first reminder of the
 * report of one's own shift that just ended (ADR 0077 § 3). One set, read by both rules, so that they never part.
 */
const PASSES_QUIET_HOURS: ReadonlySet<NotificationReason> = new Set(['own_shift_start', 'own_shift_end']);

export function isCapped(kind: NotificationReason): boolean {
  return kind !== 'sale' && !PASSES_QUIET_HOURS.has(kind);
}

/** The decision for one notification, from facts the caller has read (counts, settings, time). */
export function decideNotification(context: NotificationContext): NotificationDecision {
  if (!PASSES_QUIET_HOURS.has(context.kind)) {
    const until = quietHoursEnd(context.at, context.timeZone, context.quiet);
    if (until !== null) return { action: 'hold', until };
  }
  if (context.kind === 'sale') {
    return context.salesInBurstWindow >= SALE_BURST_SIZE ? { action: 'group' } : { action: 'ring' };
  }
  if (isCapped(context.kind) && context.cappedRungToday >= context.dailyCap) return { action: 'silent' };
  return { action: 'ring' };
}
