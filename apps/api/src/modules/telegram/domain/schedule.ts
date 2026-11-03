/** Timing rules of the deliveries (ADR 0020 §8, §9), pure. */

/** Pause between two messages in the same group: about 20 per minute at most, Telegram's limit. */
export const CHAT_SPACING_MS = 3000;

/** How long network trouble is retried before a delivery is given up. */
const RETRY_WINDOW_MS = 60 * 60 * 1000;

/** A delivery still `sending` after this was interrupted (the worker died between the call and the write). */
export const STALE_SENDING_MS = 60 * 1000;

/** The outbox scan re-reads this far behind its cursor: transactions commit out of order. */
export const SCAN_OVERLAP_MS = 2 * 60 * 1000;

/** Deliveries are kept 30 days, then purged: an alert is not a record, the conversation journal is. */
export const DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** 5 s, 10 s, 20 s… capped at 10 minutes. */
export function retryDelayMs(attempts: number): number {
  return Math.min(5000 * 2 ** Math.max(0, attempts - 1), 10 * 60 * 1000);
}

/** Network trouble keeps retrying within the window, then the delivery fails. */
export function shouldRetry(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < RETRY_WINDOW_MS;
}

function localParts(at: Date, timeZone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

/** The morning digest goes out in the creator's 8 o'clock hour; its key makes it once a day. */
const MORNING_DIGEST_HOUR = 8;

export function morningDigestKey(creatorId: string, timeZone: string, now: Date): string | null {
  const { day, hour } = localParts(now, timeZone);
  return hour === MORNING_DIGEST_HOUR ? `digest:${creatorId}:${day}` : null;
}

/** The evening digest of the sales goes out in the creator's 23 o'clock hour (CRM-04 lot b), once a day by its key. */
const EVENING_DIGEST_HOUR = 23;

/** Her day and the key of its evening digest, or null outside her 23 o'clock hour. */
export function eveningDigestOf(
  creatorId: string,
  timeZone: string,
  now: Date,
): { readonly day: string; readonly key: string } | null {
  const { day, hour } = localParts(now, timeZone);
  return hour === EVENING_DIGEST_HOUR ? { day, key: `evening:${creatorId}:${day}` } : null;
}

const NIGHT_START_HOUR = 20;

/** A night runs from 20:00 to 08:00 in the creator's time zone: the current one, or the last one during the day. */
export function nightOf(timeZone: string, now: Date): { from: Date; to: Date } {
  const hourMs = 60 * 60 * 1000;
  // The latest 20:00 local at or before now (whole hours: every time zone in use is a whole or half hour off, and
  // a half-hour zone only shifts the window by 30 minutes, harmless for a count).
  let start = new Date(Math.floor(now.getTime() / hourMs) * hourMs);
  for (let step = 0; step < 48 && localParts(start, timeZone).hour !== NIGHT_START_HOUR; step += 1) {
    start = new Date(start.getTime() - hourMs);
  }
  const end = new Date(start.getTime() + 12 * hourMs);
  return { from: start, to: end < now ? end : now };
}
