import type { EarningsSource, NotificationRequest, TeamMemberStatus } from '@impera/contracts';

import { addDays, calendarDayIn, isoWeekday } from './time';

/**
 * The reminder of an end-of-shift report (ADR 0077), pure. The member of a shift that ended without its report is told
 * on his phone twice: 15 minutes after the end, even in his quiet hours (`own_shift_end`), then 12 hours after, as any
 * reminder (`reminder`). Each only within its window, so that a worker stopped for a few hours never rings in the night
 * a shift that ended the evening before. Nothing for a cancelled shift, a shift that has a report (sent back too), a
 * fortnight paid on the sales read (`detected`, the mini feedback is optional there), an account without pay rules
 * for it (the report would be refused), nor a member who left. The message names neither the creator nor a fan
 * (ADR 0020): only the hours of the shift, in the member's zone.
 */

const MINUTE_MS = 60_000;

/** When each reminder may ring, in minutes after the shift's end: from `after` included to `until` excluded. */
export const REPORT_REMINDER_WINDOWS = {
  1: { after: 15, until: 2 * 60 },
  2: { after: 12 * 60, until: 14 * 60 },
} as const;

export type ReportReminderRank = keyof typeof REPORT_REMINDER_WINDOWS;

/** The earliest end a reminder may still ring for at `now`: the shifts the job reads end after it. */
export function oldestRemindableEnd(now: Date): Date {
  return new Date(now.getTime() - REPORT_REMINDER_WINDOWS[2].until * MINUTE_MS);
}

/** What the job reads of a shift, again just before it rings (ADR 0077 § 5). */
export interface ReportReminderFacts {
  readonly shift: { readonly id: string; readonly startsAt: Date; readonly endsAt: Date };
  readonly cancelled: boolean;
  /** Any report of the shift, whatever its state: one sent back is the agency's to follow (ADR 0073 § 5). */
  readonly reported: boolean;
  /** The source of the account's pay rules for the shift's fortnight; null when it has none. */
  readonly earningsSource: EarningsSource | null;
  readonly member: { readonly userId: string; readonly status: TeamMemberStatus; readonly timeZone: string };
}

/** Which reminder is due at `now`, or null when none is. */
export function reportReminderDue(facts: ReportReminderFacts, now: Date): ReportReminderRank | null {
  if (facts.cancelled || facts.reported) return null;
  if (facts.earningsSource !== 'declared' || facts.member.status === 'left') return null;
  const since = (now.getTime() - facts.shift.endsAt.getTime()) / MINUTE_MS;
  for (const rank of [1, 2] as const) {
    const window = REPORT_REMINDER_WINDOWS[rank];
    if (since >= window.after && since < window.until) return rank;
  }
  return null;
}

const clocks = new Map<string, Intl.DateTimeFormat>();

function clockFormat(timeZone: string): Intl.DateTimeFormat {
  const known = clocks.get(timeZone);
  if (known !== undefined) return known;
  const made = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  });
  clocks.set(timeZone, made);
  return made;
}

/** « 23 h », « 23 h 30 », in `timeZone`. */
function clockIn(at: Date, timeZone: string): string {
  const parts = clockFormat(timeZone).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const minutes = get('minute');
  return `${String(Number(get('hour')))} h${minutes === '00' ? '' : ` ${minutes}`}`;
}

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

/** « d’aujourd’hui », « d’hier », « de lundi »: the day the shift started, as the member reads it at `now`. */
function dayWords(startsAt: Date, now: Date, timeZone: string): string {
  const started = calendarDayIn(startsAt, timeZone);
  const today = calendarDayIn(now, timeZone);
  if (started === today) return 'd’aujourd’hui';
  if (started === addDays(today, -1)) return 'd’hier';
  return `de ${WEEKDAYS[isoWeekday(started) - 1] ?? started}`;
}

/** The page a touch opens: Aujourd'hui, where the report's button waits. */
const TODAY_PATH = '/aujourdhui';

/**
 * The notification of a reminder for `notify`: unique per account, reason and object, so a replayed run, two reads or
 * two workers ring it once. Each rank has one reason and its own object (`shift-report:<shift>:<rank>`): the object
 * is what makes it once. Both share a tag, so the second replaces the first on the screen.
 */
export function reportReminder(
  rank: ReportReminderRank,
  facts: ReportReminderFacts,
  now: Date,
): NotificationRequest {
  const { shift, member } = facts;
  const span = `${clockIn(shift.startsAt, member.timeZone)} – ${clockIn(shift.endsAt, member.timeZone)}`;
  return {
    userId: member.userId,
    reason: rank === 1 ? 'own_shift_end' : 'reminder',
    objectKey: `shift-report:${shift.id}:${String(rank)}`,
    timeZone: member.timeZone,
    message: {
      title: 'Rapport de fin de shift',
      body:
        rank === 1
          ? `Ton shift de ${span} est fini : fais ton rapport.`
          : `Ton rapport du shift ${dayWords(shift.startsAt, now, member.timeZone)}, ${span}, n’est pas encore fait.`,
      url: TODAY_PATH,
      tag: `shift-report:${shift.id}`,
    },
  };
}
