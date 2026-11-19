import { replyOpenAt, type AgentHours, type DayRange } from '@impera/contracts';

import { addDays, clockOf, zonedInstant } from '@/scheduling/time';

/*
 * Her dated days (ADR 0148 § 3), in words: pure, so that the panel only lays them out. A day's ranges replace her
 * week's that day; none is « pas d'IA ce jour-là ».
 */

const NBSP = ' ';
const STEP = 15;

/** « 20 h – minuit », « 0 h – 4 h » : a range of her day, its end at 24 h said « minuit ». */
export const rangeWords = (range: DayRange): string =>
  `${clockOf(range.startMinute)}${NBSP}–${NBSP}${range.endMinute === 1440 ? 'minuit' : clockOf(range.endMinute)}`;

/** « de 1 h à 8 h, de 22 h à minuit »: ranges said in a sentence. */
export const fromToWords = (ranges: readonly DayRange[]): string =>
  ranges
    .map(
      (range) =>
        `de ${clockOf(range.startMinute)} à ${range.endMinute === 1440 ? 'minuit' : clockOf(range.endMinute)}`,
    )
    .join(', ');

/** A day's ranges in a line, or the day without its AI. */
export const dayWords = (ranges: readonly DayRange[]): string =>
  ranges.length === 0 ? 'Pas d’IA ce jour-là' : ranges.map(rangeWords).join(', ');

/** « Aujourd’hui », « Demain », « samedi 21 nov. ». */
export function dateWords(date: string, today: string): string {
  if (date === today) return 'Aujourd’hui';
  if (date === addDays(today, 1)) return 'Demain';
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

/** The days the panel offers to change: today and the next ones, two weeks in all. */
export const daysAhead = (today: string, count = 14): readonly string[] =>
  Array.from({ length: count }, (_, index) => addDays(today, index));

/**
 * What the day's ranges open that her week keeps closed, by quarters of an hour: the agent will answer then too, the
 * owner's choice (Sécurité, relecture de #865: the screen says it plainly).
 */
export function openedBeyondWeek(
  hours: AgentHours,
  timeZone: string,
  date: string,
  ranges: readonly DayRange[],
): readonly DayRange[] {
  const found: DayRange[] = [];
  for (const range of ranges) {
    for (let minute = range.startMinute; minute < range.endMinute; minute += STEP) {
      if (replyOpenAt(hours, timeZone, zonedInstant(date, minute, timeZone))) continue;
      const last = found.at(-1);
      if (last?.endMinute === minute) found[found.length - 1] = { ...last, endMinute: minute + STEP };
      else found.push({ startMinute: minute, endMinute: Math.min(minute + STEP, range.endMinute) });
    }
  }
  return found.map((range) => ({ ...range, endMinute: Math.min(range.endMinute, 1440) }));
}

/** A range as the panel edits it: the end field's 0 h is midnight, the day's end. */
export const endOf = (minute: number): number => (minute === 0 ? 1440 : minute);

/** Ranges sorted by start, as the server keeps them. */
export const sortedRanges = (ranges: readonly DayRange[]): DayRange[] =>
  ranges.toSorted((a, b) => a.startMinute - b.startMinute);
