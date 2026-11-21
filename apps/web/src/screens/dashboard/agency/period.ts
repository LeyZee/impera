import type { AgencyInsights, AgencyUnit } from '@impera/contracts';

/*
 * The days « L'agence en chiffres » reads (ADR 0146): a day, a week from Monday, a calendar month or the days chosen,
 * and the period they are compared with. The server fixes the days in the platform's zone; this file only names them,
 * moves from one to the next, and lists the ones to choose from.
 */

/** What the address holds: the server turns it into days (ADR 0146 § 6). */
export type AgencySelection =
  | {
      readonly unit: Exclude<AgencyUnit, 'custom'>;
      /** A day of the period; absent, the one running today. */
      readonly at?: string;
      /** A day of the period to compare with; absent, the one just before. */
      readonly compareAt?: string;
    }
  | {
      readonly unit: 'custom';
      readonly from: string;
      readonly to: string;
      /** The first day of the span to compare with; absent, the days just before. */
      readonly compareAt?: string;
    };

/** The month running today: the screen's opening, as at Reveal (ADR 0146 § 1). */
export const DEFAULT_SELECTION: AgencySelection = { unit: 'month' };

/** `short`: the word a phone's segment has room for. */
export const UNIT_OPTIONS: readonly {
  readonly id: AgencyUnit;
  readonly label: string;
  readonly short?: string;
}[] = [
  { id: 'day', label: 'Jour' },
  { id: 'week', label: 'Semaine' },
  { id: 'month', label: 'Mois' },
  { id: 'custom', label: 'Personnalisé', short: 'Perso' },
];

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

/** A real calendar day: « 2026-02-31 » is none (Date would roll it to 3 March; the server refuses it). */
export const isDay = (value: unknown): value is string =>
  typeof value === 'string' &&
  DAY.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export const dayCount = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

/** The first day (Monday) of the week holding `day`. */
export function mondayOf(day: string): string {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return shiftDay(day, -weekday);
}

/** The first day of the month `months` away from the one holding `day`. */
export function monthStart(day: string, months = 0): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7)) - 1 + months;
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

/** The first day of the period of `unit` holding `day`. */
export function periodStart(unit: Exclude<AgencyUnit, 'custom'>, day: string): string {
  return unit === 'day' ? day : unit === 'week' ? mondayOf(day) : monthStart(day);
}

/** The first day of the period `steps` periods of `unit` away from the one starting `start`. */
export function stepPeriod(unit: Exclude<AgencyUnit, 'custom'>, start: string, steps: number): string {
  return unit === 'day'
    ? shiftDay(start, steps)
    : unit === 'week'
      ? shiftDay(start, 7 * steps)
      : monthStart(start, steps);
}

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const WEEKDAY = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

const at = (day: string): Date => new Date(`${day}T12:00:00Z`);
const capital = (text: string): string => text.replace(/^./u, (first) => first.toUpperCase());
/** « 1er » for the first of a month, as French writes it. */
const dayNumber = (day: string): string => (day.endsWith('-01') ? '1er' : String(Number(day.slice(8, 10))));

/** « Novembre 2026 ». */
export const monthLabel = (day: string): string => capital(MONTH.format(at(day)));

/** « 4 nov. », « 1er oct. ». */
export function shortDate(day: string): string {
  const text = DAY_MONTH.format(at(day));
  return day.endsWith('-01') ? text.replace(/^1 /u, '1er ') : text;
}

/**
 * The days from `from` to `to`, as short as they read: « 16 nov. », « 1er–16 oct. », « 28 sept. – 4 oct. », the year
 * added when it is not `today`'s.
 */
export function spanText(from: string, to: string, today: string): string {
  const year =
    to.slice(0, 4) === today.slice(0, 4) && from.slice(0, 4) === to.slice(0, 4) ? '' : ` ${to.slice(0, 4)}`;
  const fromYear = from.slice(0, 4) === to.slice(0, 4) ? '' : ` ${from.slice(0, 4)}`;
  if (from === to) return `${shortDate(from)}${year}`;
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${dayNumber(from)}–${shortDate(to)}${year}`;
  }
  return `${shortDate(from)}${fromYear} – ${shortDate(to)}${year}`;
}

/** « Aujourd’hui », « Hier », « sam. 14 nov. ». */
export function dayName(day: string, today: string): string {
  if (day === today) return 'Aujourd’hui';
  if (day === shiftDay(today, -1)) return 'Hier';
  const text = WEEKDAY.format(at(day));
  return day.slice(0, 4) === today.slice(0, 4) ? text : `${text} ${day.slice(0, 4)}`;
}

/** The name of the period of `unit` starting `start`: « Novembre 2026 », « 9–15 nov. », « Hier ». */
export function periodName(unit: Exclude<AgencyUnit, 'custom'>, start: string, today: string): string {
  if (unit === 'month') return monthLabel(start);
  if (unit === 'day') return dayName(start, today);
  return spanText(start, shiftDay(start, 6), today);
}

/** The heading of the days read: the period's own name, its days when it is cut at today. */
export function readName(insights: Pick<AgencyInsights, 'span' | 'from' | 'to'>): string {
  const { span, from, to } = insights;
  if (span.unit === 'custom' || span.unit === 'rolling') return spanText(from, to, span.today);
  return periodName(span.unit, from, span.today);
}

/** « comparé au 1er–16 oct. »: the days the percentages are read against, always written (ADR 0146 § 2). */
export function againstText(insights: Pick<AgencyInsights, 'span' | 'previousFrom' | 'previousTo'>): string {
  const days = spanText(insights.previousFrom, insights.previousTo, insights.span.today);
  return insights.previousFrom === insights.previousTo ? `comparé au ${days}` : `comparé aux ${days}`;
}

/** The arrows (ADR 0146 § 1): the period before, the one after unless it is to come. */
export function neighbours(
  selection: AgencySelection,
  insights: Pick<AgencyInsights, 'span' | 'from'>,
): { readonly previous: AgencySelection; readonly next: AgencySelection | null } {
  const { span, from } = insights;
  if (selection.unit === 'custom') {
    const length = dayCount(selection.from, selection.to);
    const after = shiftDay(selection.to, 1);
    return {
      previous: { unit: 'custom', from: shiftDay(selection.from, -length), to: shiftDay(selection.from, -1) },
      next: after > span.today ? null : { unit: 'custom', from: after, to: shiftDay(selection.to, length) },
    };
  }
  const { unit } = selection;
  const start = periodStart(unit, from);
  const following = stepPeriod(unit, start, 1);
  return {
    previous: { unit, at: stepPeriod(unit, start, -1) },
    next: following > span.today ? null : { unit, at: following },
  };
}

/** The periods offered in the list under the name: the running one, then back as far as `count` (none to come). */
export function periodChoices(
  unit: Exclude<AgencyUnit, 'custom'>,
  today: string,
  count: number,
): { readonly value: string; readonly label: string }[] {
  const running = periodStart(unit, today);
  return Array.from({ length: count }, (_, i) => {
    const start = stepPeriod(unit, running, -i);
    return { value: start, label: periodName(unit, start, today) };
  });
}

/** « vs mois précédent »: the default comparison, named by its unit. */
export const PREVIOUS_LABEL: Readonly<Record<AgencyUnit, string>> = {
  day: 'vs veille',
  week: 'vs semaine précédente',
  month: 'vs mois précédent',
  custom: 'vs période précédente',
};

/** The value of the default comparison in the list of comparisons. */
export const PREVIOUS = 'previous';

/**
 * The comparisons offered (ADR 0146 § 3): the period just before first, then the earlier ones of the same unit; for
 * days chosen, the same days a year before.
 */
export function compareChoices(
  selection: AgencySelection,
  from: string,
  today: string,
): { readonly value: string; readonly label: string }[] {
  const previous = { value: PREVIOUS, label: PREVIOUS_LABEL[selection.unit] };
  if (selection.unit === 'custom') {
    const yearBefore = shiftDay(from, -364);
    return [previous, { value: yearBefore, label: 'vs un an plus tôt' }];
  }
  const { unit } = selection;
  const start = periodStart(unit, from);
  const count = unit === 'month' ? 24 : unit === 'week' ? 26 : 35;
  // The one just before is « previous »: the list goes on from the one before it.
  const earlier = Array.from({ length: count - 1 }, (_, i) => stepPeriod(unit, start, -(i + 2)));
  // In the list, a month is a word in a sentence: « vs septembre 2026 »; the pastille, a title, keeps its capital.
  const named = earlier.map((value) => {
    const name = periodName(unit, value, today);
    return { value, label: `vs ${name.charAt(0).toLocaleLowerCase('fr') + name.slice(1)}` };
  });
  if (unit === 'day') {
    // The same weekday a week before reads first: a Saturday compares with a Saturday.
    const week = shiftDay(start, -7);
    return [
      previous,
      { value: week, label: 'vs même jour, semaine précédente' },
      ...named.filter((one) => one.value !== week),
    ];
  }
  return [previous, ...named];
}

/** The selection's comparison as the list holds it. */
export const compareValue = (selection: AgencySelection): string => selection.compareAt ?? PREVIOUS;

/** The same selection compared with `value` from the list. */
export function withCompare(selection: AgencySelection, value: string): AgencySelection {
  if (value !== PREVIOUS) return { ...selection, compareAt: value };
  if (selection.unit === 'custom') return { unit: 'custom', from: selection.from, to: selection.to };
  return { unit: selection.unit, ...(selection.at === undefined ? {} : { at: selection.at }) };
}

/** A unit picked on the segment: its period running today, compared with the one before. */
export function ofUnit(
  unit: AgencyUnit,
  insights: Pick<AgencyInsights, 'from' | 'to' | 'span'> | null,
): AgencySelection {
  if (unit !== 'custom') return { unit };
  // The days chosen start as the days shown, so the field opens on something to change.
  if (insights !== null) return { unit, from: insights.from, to: insights.to };
  return { unit: 'month' };
}

/** The register's days do not reach back to the comparison's first day: no percentage (ADR 0146 § 4). */
export const comparable = (insights: Pick<AgencyInsights, 'registerSince' | 'previousFrom'>): boolean =>
  insights.registerSince === null || insights.registerSince <= insights.previousFrom;

/**
 * The least a period needs before the screen draws a conclusion from it (ADR 0092 § 5): sales counted, and days of
 * the period the registers already covered.
 */
export const CONCLUDE_MIN_SALES = 30;
export const CONCLUDE_MIN_REGISTER_DAYS = 7;

/**
 * What the screen writes instead of a conclusion it cannot draw yet; the figures stay (ADR 0092 § 5). Too few sales
 * and a register too young are said apart (Charles, 20/11).
 */
export const TOO_FEW_TO_CONCLUDE = 'Pas encore assez de ventes pour conclure.';
export const TOO_YOUNG_TO_CONCLUDE = 'Pas encore assez de recul pour conclure.';

/**
 * The days of the period the registers covered: from the later of its first day and the registers' first line to the
 * earlier of its last day and today, both included; none without a line.
 */
export function registerDays(
  insights: Pick<AgencyInsights, 'from' | 'to' | 'registerSince' | 'span'>,
): number {
  if (insights.registerSince === null) return 0;
  const start = insights.registerSince > insights.from ? insights.registerSince : insights.from;
  const end = insights.span.today < insights.to ? insights.span.today : insights.to;
  return end < start ? 0 : dayCount(start, end);
}

/**
 * Whether an insight sentence (the slot that brings in the most, the concentration, the share of new payers) may be
 * written for the period (ADR 0092 § 5): enough sales and enough days of register, or no conclusion at all.
 */
export const canConclude = (
  insights: Pick<AgencyInsights, 'from' | 'to' | 'registerSince' | 'span' | 'totals'>,
): boolean => conclusionWait(insights) === null;

/**
 * Why no conclusion is drawn yet, as the screen writes it, or null when one may be: a register too young first (it is
 * also why the sales are few), then too few sales.
 */
export function conclusionWait(
  insights: Pick<AgencyInsights, 'from' | 'to' | 'registerSince' | 'span' | 'totals'>,
): string | null {
  if (registerDays(insights) < CONCLUDE_MIN_REGISTER_DAYS) return TOO_YOUNG_TO_CONCLUDE;
  if (insights.totals.current.sales < CONCLUDE_MIN_SALES) return TOO_FEW_TO_CONCLUDE;
  return null;
}

/** The query string of `GET /v1/dashboard/agency` for a selection. */
export function selectionQuery(selection: AgencySelection): Record<string, string> {
  const compare = selection.compareAt === undefined ? {} : { compareAt: selection.compareAt };
  if (selection.unit === 'custom') {
    return { unit: selection.unit, from: selection.from, to: selection.to, ...compare };
  }
  return { unit: selection.unit, ...(selection.at === undefined ? {} : { at: selection.at }), ...compare };
}
