/**
 * The calendar feed (CR-12, ADR 0045 § 5): a member's own shifts as an iCalendar file (RFC 5545), for Apple Agenda
 * and Google Agenda. Pure: the slot, the creator and the member's name in the team, nothing else (never an amount,
 * a fan, a leave or a report). Times are written in UTC, which every calendar shows in its own zone.
 */

/** What the feed covers around now: two weeks back, four ahead, the 42 days `calendar_shifts` reads at most. */
const FEED_DAYS_BEFORE = 14;
const FEED_DAYS_AFTER = 28;
const DAY_MS = 86_400_000;

export function feedWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - FEED_DAYS_BEFORE * DAY_MS),
    to: new Date(now.getTime() + FEED_DAYS_AFTER * DAY_MS),
  };
}

export interface FeedEvent {
  /** Stable across reads, so that a calendar updates an event instead of doubling it. */
  readonly uid: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly summary: string;
  readonly description: string;
}

/** `20261103T120000Z`. */
const utc = (at: Date): string =>
  at
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}/u, '');

/** TEXT values (RFC 5545 § 3.3.11): backslash, semicolon, comma and line breaks escaped. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/;/gu, '\\;')
    .replace(/,/gu, '\\,')
    .replace(/\r\n|\r|\n/gu, '\\n');
}

/** Lines of 75 octets at most (§ 3.1), the next ones opening with a space, never cutting a character in two. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** The whole file, CRLF line ends; `stamp` is when it was made (`DTSTAMP`). */
export function icsOf(input: { name: string; events: readonly FeedEvent[]; stamp: Date }): string {
  const stamp = utc(input.stamp);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Impera//Shifts//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `NAME:${escapeText(input.name)}`,
    `X-WR-CALNAME:${escapeText(input.name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const event of input.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(event.uid)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utc(event.startsAt)}`,
      `DTEND:${utc(event.endsAt)}`,
      `SUMMARY:${escapeText(event.summary)}`,
      `DESCRIPTION:${escapeText(event.description)}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
