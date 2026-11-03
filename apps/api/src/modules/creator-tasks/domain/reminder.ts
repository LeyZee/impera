import type { CreatorTask, PushMessage } from '@impera/contracts';

/**
 * Her reminders (CR-05 lot b3, ADR 0042 § 7), pure. A task at an hour may carry a reminder she chose, in minutes before
 * it starts. One job per task, keyed by the task (`creator_tasks.remind:<taskId>`): a move puts it at the new time,
 * and the job rings only for the start it was scheduled for. Nothing rings once the task has started, nor for a task
 * removed or no longer at an hour: what the agenda shows is all she needs then. The message says what and when, in
 * her zone; never a fan, a chatter nor an amount (ADR 0020).
 */

const MINUTE_MS = 60_000;

/** When a task's reminder rings, or null when it has none (a task of a day, routine, or no reminder chosen). */
export function reminderAt(task: CreatorTask): Date | null {
  if (task.when.kind !== 'timed' || task.reminderMinutes === null) return null;
  return new Date(Date.parse(task.when.startsAt) - task.reminderMinutes * MINUTE_MS);
}

const clocks = new Map<string, Intl.DateTimeFormat>();

function clockFormat(timeZone: string): Intl.DateTimeFormat {
  const known = clocks.get(timeZone);
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
  clocks.set(timeZone, made);
  return made;
}

/** Her day (`YYYY-MM-DD`) and her clock (« 14 h », « 14 h 30 ») at an instant, in her zone. */
export function wallClock(at: Date, timeZone: string): { readonly day: string; readonly clock: string } {
  const parts = clockFormat(timeZone).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const minutes = get('minute');
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    clock: `${String(Number(get('hour')))} h${minutes === '00' ? '' : ` ${minutes}`}`,
  };
}

/** « 15 min », « 1 h », « 1 h 30 »: how long until it starts, rounded to the minute. */
export function untilWords(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest).padStart(2, '0')}`;
}

/**
 * The notification of a task's reminder at `now`, or null when it no longer rings: removed, no longer at an hour, no
 * reminder, moved since the job was scheduled (`scheduledStart`, whose own job rings instead), or already started.
 */
export function reminderMessage(
  task: CreatorTask | null,
  scheduledStart: string,
  timeZone: string,
  now: Date,
): PushMessage | null {
  if (task?.when.kind !== 'timed' || task.reminderMinutes === null) return null;
  const start = Date.parse(task.when.startsAt);
  if (start !== Date.parse(scheduledStart) || now.getTime() >= start) return null;
  const left = Math.max(1, Math.round((start - now.getTime()) / MINUTE_MS));
  const from = wallClock(new Date(start), timeZone);
  const to = wallClock(new Date(task.when.endsAt), timeZone);
  return {
    title: task.title,
    body: `Dans ${untilWords(left)} · ${from.clock} – ${to.clock}`,
    url: `/agenda?jour=${from.day}`,
    tag: `task:${task.id}`,
  };
}
