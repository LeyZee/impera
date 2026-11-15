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

export interface DatedTurn {
  readonly fromFan: boolean;
  readonly at?: Date;
}

function localParts(at: Date, timeZone: string): { day: number; weekday: string; clock: string } {
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
    // Days since the epoch on her calendar: « the next day » is a change of date on her clock, not 24 hours.
    day: Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day'))) / DAY_MS,
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

/**
 * The dated line of each turn: only before a message of his that comes an hour or more after the one before it,
 * whoever wrote that one. Hers carry none, so that the voice never learns to write such a line itself.
 */
export function gapNotes(turns: readonly DatedTurn[], timeZone: string): readonly (string | null)[] {
  return turns.map((turn, index) => {
    const previous = turns[index - 1]?.at;
    if (!turn.fromFan || turn.at === undefined || previous === undefined) return null;
    return gapNote(previous, turn.at, timeZone);
  });
}

/**
 * What « Le moment » says of the last exchanges, at `now`: how long he took to answer her, or that her answer stayed
 * long without one; and that she answers late. Nothing under the thresholds, nothing for a turn without a date.
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
  if (waiting >= GAP_MS) lines.push(`Il t’a écrit il y a ${spanLabel(waiting)} : tu lui réponds en retard.`);
  return lines;
}
