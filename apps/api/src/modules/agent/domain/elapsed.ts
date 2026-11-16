/**
 * The time that passed in the conversation, written by code for the brain and the voice (audit du naturel, A2): a
 * dated line before a message of his that comes after a silence, and what « Le moment » says of the last exchanges.
 * Facts only, in French, on her clock. A turn without a date (an eval without one) gets nothing.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Below this, two messages read as one exchange: no line is written. */
const GAP_MS = HOUR_MS;
/**
 * Her day starts at 5 a.m. on her clock: 23 h 10 then 0 h 25 is the same evening, not « le lendemain » (relecture de
 * l'audit sur #774).
 */
const DAY_START_MS = 5 * HOUR_MS;

export interface DatedTurn {
  readonly fromFan: boolean;
  readonly at?: Date;
}

function localParts(at: Date, timeZone: string): { day: number; weekday: string; clock: string } {
  const format = (date: Date) =>
    new Intl.DateTimeFormat('fr-FR', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
  const dayParts = format(new Date(at.getTime() - DAY_START_MS));
  const dayPart = (type: string): number => Number(dayParts.find((p) => p.type === type)?.value ?? '');
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const minute = part('minute');
  return {
    // Days since the epoch on her calendar, starting at 5 a.m.: « the next day » is a new day of hers, not 24 hours.
    day: Date.UTC(dayPart('year'), dayPart('month') - 1, dayPart('day')) / DAY_MS,
    weekday: part('weekday'),
    clock: `${String(Number(part('hour')))} h${minute === '00' ? '' : ` ${minute}`}`,
  };
}

/** A span as she would say it: « 12 min », « 3 h », « 5 jours », « 2 semaines », « 3 mois ». */
export function spanLabel(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE_MS);
  if (minutes < 1) return 'moins d’une minute';
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)} h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${String(days)} jours`;
  if (days < 60) return `${String(Math.floor(days / 7))} semaines`;
  return `${String(Math.floor(days / 30))} mois`;
}

/**
 * The line before a message written `at`, after one written `previous`: `null` under an hour. On her calendar:
 * « 3 h plus tard, 19 h 10 », « le lendemain, mardi, 19 h 10 », « 4 jours plus tard, samedi, 14 h ».
 */
export function gapNote(previous: Date, at: Date, timeZone: string): string | null {
  const ms = at.getTime() - previous.getTime();
  if (ms < GAP_MS) return null;
  const then = localParts(previous, timeZone);
  const now = localParts(at, timeZone);
  const days = now.day - then.day;
  if (days <= 0) return `${spanLabel(ms)} plus tard, ${now.clock}`;
  if (days === 1) return `le lendemain, ${now.weekday}, ${now.clock}`;
  return `${spanLabel(days * DAY_MS)} plus tard, ${now.weekday}, ${now.clock}`;
}

/** The time of a message on her clock, alone: « mardi, 9 h 10 ». */
function clockNote(at: Date, timeZone: string): string {
  const { weekday, clock } = localParts(at, timeZone);
  return `${weekday}, ${clock}`;
}

/**
 * The dated line of each turn: only before a message of his that comes an hour or more after the one before it,
 * whoever wrote that one. When the silence came before her answer and he answers her quickly (she answered the next
 * morning, or followed up two days later), his message carries its time on her clock: the history never reads as one
 * evening. Hers carry none, so that the voice never learns to write such a line itself.
 */
export function gapNotes(turns: readonly DatedTurn[], timeZone: string): readonly (string | null)[] {
  return turns.map((turn, index) => {
    const previous = turns[index - 1];
    if (!turn.fromFan || turn.at === undefined || previous?.at === undefined) return null;
    const note = gapNote(previous.at, turn.at, timeZone);
    if (note !== null || previous.fromFan) return note;
    // Her run just before: was there a silence before it, since his last message?
    let start = index - 1;
    while (start > 0 && turns[start - 1]?.fromFan === false) start -= 1;
    const his = turns[start - 1]?.at;
    const hers = turns[start]?.at;
    if (his === undefined || hers === undefined) return null;
    return hers.getTime() - his.getTime() >= GAP_MS ? clockNote(turn.at, timeZone) : null;
  });
}

/**
 * What « Le moment » says of the last exchanges, at `now`: how long he took to answer her, or that her answer stayed
 * long without one; and how long ago he wrote. Facts only: whether that is late is hers to feel. Nothing under the thresholds, nothing for a turn without a date.
 */
export function timingLines(turns: readonly DatedTurn[], now: Date): readonly string[] {
  const last = turns.at(-1);
  if (last?.at === undefined) return [];
  if (!last.fromFan) {
    // A follow-up: she wrote last, and he has not answered.
    const silent = now.getTime() - last.at.getTime();
    return silent >= GAP_MS
      ? [`Ta dernière réponse date d’il y a ${spanLabel(silent)} et il n’y a pas répondu.`]
      : [];
  }
  let start = turns.length - 1;
  while (start > 0 && turns[start - 1]?.fromFan === true) start -= 1;
  const first = turns[start]?.at;
  if (first === undefined) return [];
  const lines: string[] = [];
  // The turn before his run is hers: the loop above took every message of his.
  const hers = turns[start - 1]?.at;
  if (hers !== undefined) {
    const gap = first.getTime() - hers.getTime();
    lines.push(
      gap >= GAP_MS
        ? `Ta dernière réponse date d’il y a ${spanLabel(now.getTime() - hers.getTime())} : il ne t’avait pas répondu depuis.`
        : `Il a mis ${spanLabel(gap)} à te répondre.`,
    );
  }
  const waiting = now.getTime() - first.getTime();
  if (waiting >= GAP_MS) lines.push(`Il t’a écrit il y a ${spanLabel(waiting)}.`);
  return lines;
}
