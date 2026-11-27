import {
  PLATFORM_NAMES,
  PUSH_BODY_MAX,
  PUSH_TITLE_MAX,
  type Platform,
  type PlatformAccountId,
  type PushMessage,
  type SessionState,
} from '@impera/contracts';

/**
 * The reminder to reconnect the AI's platform sessions (décision de Charles du 27/11/2026, audit de robustesse R3).
 * Reveal's token lives 24 h from the login and is never renewed: without an owner's « Synchroniser » each day, the AI
 * stops reading and answering. Every owner is told:
 * - at the agency's hour (18 h by default, Réglages › Alertes), for each account whose token will not last the night;
 * - once more an hour later, if nothing changed;
 * - 2 h before a token dies, only when no daily ring told of it: a token the hour found with less than 20 h left was
 *   already told (and its expiry within the night always is), so the warning is left to tokens synced shortly before
 *   the hour, which die before the next one. With the hour at 18 h, it falls between 12 h and 16 h, never at night.
 * Each ring is once per account and day, or per token: a run again rings nothing new.
 */

/** An account's session as read for the reminder (`connectors`' `SessionClock`). */
export interface SessionReminderClock {
  readonly platformAccountId: PlatformAccountId;
  readonly platform: Platform;
  readonly creatorName: string;
  readonly state: Exclude<SessionState, 'none'>;
  readonly expiresAt: Date | null;
}

type SessionReminderKind = 'daily' | 'again' | 'before_expiry';

export interface SessionReminderDue {
  readonly clock: SessionReminderClock;
  readonly kind: SessionReminderKind;
  /** The notification's object: once per account and agency day, or per token for the warning before it dies. */
  readonly objectKey: string;
  readonly message: PushMessage;
}

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;
/** A token with less than this left at the agency's hour will not last until the next day's: the reminder rings. */
const SESSION_REMINDER_FRESH_MS = 20 * 3_600_000;
/** « Once more an hour later. » */
const AGAIN_AFTER_MINUTES = 60;
/** The warning before a token dies. */
const SESSION_REMINDER_BEFORE_EXPIRY_MS = 2 * 3_600_000;
/** How long after its minute a ring is still due: the job runs every 5 minutes, a run missed is caught up. */
const DUE_WINDOW_MINUTES = 30;

/** The minute of the day and the date at `at` on the agency's clock, by `Intl` only. */
function wallClock(at: Date, timeZone: string): { readonly minute: number; readonly day: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    minute: Number(part('hour')) * 60 + Number(part('minute')),
    day: `${part('year')}-${part('month')}-${part('day')}`,
  };
}

/** Minutes since the last `minute` of the agency's day at `at` (0 at that minute, up to 1 439). */
function minutesSince(at: Date, minute: number, timeZone: string): number {
  return (wallClock(at, timeZone).minute - minute + DAY_MINUTES) % DAY_MINUTES;
}

/** « 18 h » or « 18 h 05 » on the agency's clock. */
export function clockText(at: Date, timeZone: string): string {
  const { minute } = wallClock(at, timeZone);
  const hours = String(Math.floor(minute / 60));
  const rest = minute % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** The gesture, said the same way each time: the bot's account, never one's own (P2-02). */
const GESTURE =
  'Dans le profil Chrome de l’IA, reconnecte le « bot » sur Reveal, puis « Synchroniser » dans l’extension.';

function messageOf(
  clock: SessionReminderClock,
  kind: SessionReminderKind,
  now: Date,
  timeZone: string,
): PushMessage {
  const platform = PLATFORM_NAMES[clock.platform];
  const subject = kind === 'again' ? `Rappel · reconnexion ${platform}` : `Reconnexion ${platform}`;
  const expiresAt = clock.expiresAt;
  const when =
    clock.state === 'expired' || (expiresAt !== null && expiresAt.getTime() <= now.getTime())
      ? `La session ${platform} de l’IA a expiré : l’IA ne lit plus rien.`
      : expiresAt === null
        ? `La session ${platform} de l’IA ne dit pas quand elle expire.`
        : `La session ${platform} de l’IA expire à ${clockText(expiresAt, timeZone)}.`;
  return {
    title: cut(`${clock.creatorName} · ${subject}`, PUSH_TITLE_MAX),
    body: cut(`${when} ${GESTURE}`, PUSH_BODY_MAX),
    url: '/',
    // A later reminder of the same account replaces the earlier one on the screen.
    tag: `session-reminder:${clock.platformAccountId}`,
  };
}

/** Will this token not last until the agency's hour tomorrow? An expired or unreadable one never does. */
function needsReconnect(clock: SessionReminderClock, now: Date): boolean {
  if (clock.state === 'expired' || clock.expiresAt === null) return true;
  return clock.expiresAt.getTime() - now.getTime() < SESSION_REMINDER_FRESH_MS;
}

/**
 * The rings due at `now` for these accounts, on the agency's clock, the reminder at `minute` of its day. Pure: the
 * job sends them, the notification's key keeps each one to once.
 */
export function sessionRemindersDue(input: {
  readonly clocks: readonly SessionReminderClock[];
  readonly minute: number;
  readonly timeZone: string;
  readonly now: Date;
}): SessionReminderDue[] {
  const { clocks, minute, timeZone, now } = input;
  const due: SessionReminderDue[] = [];
  const sinceDaily = minutesSince(now, minute, timeZone);
  // The agency day of the ring: the date at the reminder's own minute, not at the run (a run past midnight).
  const dailyDay = wallClock(new Date(now.getTime() - sinceDaily * MINUTE_MS), timeZone).day;
  const dailyKind: SessionReminderKind | null =
    sinceDaily < DUE_WINDOW_MINUTES
      ? 'daily'
      : sinceDaily >= AGAIN_AFTER_MINUTES && sinceDaily < AGAIN_AFTER_MINUTES + DUE_WINDOW_MINUTES
        ? 'again'
        : null;
  for (const clock of clocks) {
    if (dailyKind !== null && needsReconnect(clock, now)) {
      due.push({
        clock,
        kind: dailyKind,
        objectKey: `session_reminder:${clock.platformAccountId}:${dailyDay}:${dailyKind}`,
        message: messageOf(clock, dailyKind, now, timeZone),
      });
      continue;
    }
    const expiresAt = clock.expiresAt;
    if (clock.state === 'expired' || expiresAt === null) continue;
    const left = expiresAt.getTime() - now.getTime();
    if (left <= 0 || left > SESSION_REMINDER_BEFORE_EXPIRY_MS) continue;
    // The last agency hour before it dies found it with less than 20 h left: the daily ring told of it (it rings at
    // that hour, or did the evening before). A warning held through the quiet hours would come after the token's end.
    if (minutesSince(expiresAt, minute, timeZone) * MINUTE_MS < SESSION_REMINDER_FRESH_MS) continue;
    due.push({
      clock,
      kind: 'before_expiry',
      objectKey: `session_reminder:${clock.platformAccountId}:expiry:${expiresAt.toISOString()}`,
      message: messageOf(clock, 'before_expiry', now, timeZone),
    });
  }
  return due;
}
