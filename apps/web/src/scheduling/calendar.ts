import {
  CALENDAR_MAX_DAYS,
  shiftSlotsOf,
  type Calendar,
  type CalendarAgent,
  type CalendarShift,
  type PlanningMember,
} from '@nirvana/contracts';

import { leftOf, phaseOf } from './model';
import { addDays, clockAt, clockOf, mondayOf, zonedInstant } from './time';

/**
 * Équipe › Calendrier as the screens draw it (CR-12, ADR 0045 § 1, ADR 0048): each creator's day cut into the agency's
 * créneaux, who is on each, and the agent written in words. The server reads the agent's hours on her clock
 * (`answers`); this file only crosses them with the créneaux, so that no hour is read on a clock twice.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface Span {
  readonly from: number;
  readonly to: number;
}

/** How the agent stands in one créneau: the part he answers, and how to say it. */
export interface AgentInSlot {
  readonly mode: 'auto' | 'copilot';
  /** The créneau whole, from its start, or not at all: « IA », « IA dès 9 h », « IA jusqu’à 1 h ». */
  readonly full: boolean;
  readonly from: Date;
  readonly to: Date;
}

export interface CalendarCell {
  readonly from: Date;
  readonly to: Date;
  /**
   * The shifts that cover part of it, wherever they start, with their own hours: a shift across two créneaux is drawn
   * on both (ADR 0049 § 1); the month marks the créneau with the first.
   */
  readonly shifts: readonly CalendarShift[];
  /** A shift covers part of it. */
  readonly held: boolean;
  /** `null` when he does not answer in it, or under Arrêt. */
  readonly agent: AgentInSlot | null;
  /** No chatter on what is left of it (all of it, once gone by) and the agent answers that in Automatique (ADR 0048 § 1). */
  readonly aiAlone: boolean;
}

export interface CalendarRow {
  readonly creator: Calendar['creators'][number];
  readonly agent: CalendarAgent | null;
  readonly days: ReadonlyMap<string, readonly CalendarCell[]>;
}

const spansOf = (list: readonly { readonly startsAt: string; readonly endsAt: string }[]): Span[] =>
  list.map((one) => ({ from: Date.parse(one.startsAt), to: Date.parse(one.endsAt) }));

/** The part of `span` the spans (sorted, joined) cover, as one stretch: the first to the last minute covered. */
function coveredPart(spans: readonly Span[], span: Span): Span | null {
  let from: number | null = null;
  let to = 0;
  let minutes = 0;
  for (const one of spans) {
    const start = Math.max(one.from, span.from);
    const end = Math.min(one.to, span.to);
    if (end <= start) continue;
    from ??= start;
    to = end;
    minutes += end - start;
  }
  return from === null || minutes === 0 ? null : { from, to };
}

const coversAll = (spans: readonly Span[], span: Span): boolean =>
  span.to <= span.from || spans.some((one) => one.from <= span.from && one.to >= span.to);

/**
 * How the agent stands in one créneau (ADR 0048): the part he answers, and whether he holds it alone, which takes
 * Automatique, no shift on what is left of it (all of it, once gone by) and his hours over all of that. `shifts` are
 * the spans of the shifts that count for it (a creator's, an account's). The same rule as the server's `slotsToFill`.
 */
export function agentOnSlot(
  agent: CalendarAgent | null,
  cut: Span,
  shifts: readonly Span[],
  now: Date,
): { agent: AgentInSlot | null; aiAlone: boolean } {
  if (agent === null || agent.mode === 'stop') return { agent: null, aiAlone: false };
  const answers = spansOf(agent.answers);
  const part = coveredPart(answers, cut);
  const ahead = Math.ceil(now.getTime() / MINUTE_MS) * MINUTE_MS;
  const rest = { from: cut.to <= ahead ? cut.from : Math.max(cut.from, ahead), to: cut.to };
  const onRest = shifts.some((span) => span.from < rest.to && span.to > rest.from);
  return {
    agent:
      part === null
        ? null
        : {
            mode: agent.mode,
            full: coversAll(answers, cut),
            from: new Date(part.from),
            to: new Date(part.to),
          },
    aiAlone: agent.mode === 'auto' && rest.to > rest.from && !onRest && coversAll(answers, rest),
  };
}

/**
 * Each creator's days cut into the agency's créneaux (`settings`), from `days` (calendar days in the agency's zone).
 * A créneau ends where the next starts, in wall-clock time: the night of a change of time has one an hour longer or
 * shorter. `now` decides what is left of a créneau under way.
 */
export function calendarRows(calendar: Calendar, days: readonly string[], now: Date): CalendarRow[] {
  const { settings } = calendar;
  const zone = settings.timeZone;
  const slots = shiftSlotsOf(settings);
  const length = settings.slotLengthMinutes;
  const windows = days.map((day) => ({
    day,
    cuts: slots.map((_, index) => ({
      from: zonedInstant(day, settings.slotStartMinute + index * length, zone).getTime(),
      to: zonedInstant(day, settings.slotStartMinute + (index + 1) * length, zone).getTime(),
    })),
  }));
  return calendar.creators.map((creator) => {
    const agent = calendar.agent.find((one) => one.creatorId === creator.id) ?? null;
    const theirs = calendar.shifts.filter((shift) => shift.creatorId === creator.id);
    const spans = spansOf(theirs);
    const cells = new Map<string, CalendarCell[]>();
    for (const { day, cuts } of windows) {
      cells.set(
        day,
        cuts.map((cut) => {
          // Every créneau a shift touches shows it, one begun before the window included.
          const over = theirs.filter(
            (shift) => Date.parse(shift.startsAt) < cut.to && Date.parse(shift.endsAt) > cut.from,
          );
          const { agent: inSlot, aiAlone } = agentOnSlot(agent, cut, spans, now);
          return {
            from: new Date(cut.from),
            to: new Date(cut.to),
            shifts: over,
            held: over.length > 0,
            agent: inSlot,
            aiAlone,
          };
        }),
      );
    }
    return { creator, agent, days: cells };
  });
}

const MODE_WORD = { auto: 'automatique', copilot: 'copilote' } as const;

/** « IA » on a créneau it covers whole, « IA dès 9 h » or « IA jusqu’à 1 h » on part of it. */
export function agentSlotLabel(
  agent: AgentInSlot,
  cell: Pick<CalendarCell, 'from' | 'to'>,
  zone: string,
): string {
  if (agent.full) return 'IA';
  return agent.from.getTime() > cell.from.getTime()
    ? `IA dès ${clockAt(agent.from, zone)}`
    : `IA jusqu’à ${clockAt(agent.to, zone)}`;
}

/**
 * The label on a creator's row (ADR 0048 § 2): « IA automatique · 9 h – 1 h », « IA copilote · jour et nuit »,
 * « IA automatique · selon les jours » when her slots differ from day to day, « IA à l’arrêt » under Arrêt.
 */
export function agentRowLabel(agent: CalendarAgent): string {
  if (agent.mode === 'stop') return 'IA à l’arrêt';
  const mode = MODE_WORD[agent.mode];
  if (agent.reply.mode === 'always') return `IA ${mode} · jour et nuit`;
  const on = agent.reply.slots.filter((slot) => slot.enabled);
  const ranges = new Set(on.map((slot) => `${String(slot.startMinute)}-${String(slot.endMinute)}`));
  const [only] = on;
  if (ranges.size !== 1 || only === undefined) return `IA ${mode} · selon les jours`;
  const days = on.length === 7 ? '' : ', certains jours';
  const hours =
    only.startMinute === only.endMinute
      ? 'toute la journée'
      : `${clockOf(only.startMinute)}\u00a0–\u00a0${clockOf(only.endMinute)}`;
  return `IA ${mode} · ${hours}${days}`;
}

/** The agent in a créneau, in words: « l’IA en automatique », « l’IA en copilote dès 9 h ». */
export function agentWords(
  agent: AgentInSlot,
  cell: Pick<CalendarCell, 'from' | 'to'>,
  zone: string,
): string {
  const mode = MODE_WORD[agent.mode];
  if (agent.full) return `l’IA en ${mode}`;
  return agent.from.getTime() > cell.from.getTime()
    ? `l’IA en ${mode} dès ${clockAt(agent.from, zone)}`
    : `l’IA en ${mode} jusqu’à ${clockAt(agent.to, zone)}`;
}

/** The same, after what precedes it (« Kofi, 12 h – 18 h ; l’IA en automatique dès 14 h »), empty without him. */
export const cellAgentWords = (
  agent: AgentInSlot | null,
  cell: Pick<CalendarCell, 'from' | 'to'>,
  zone: string,
): string => (agent === null ? '' : ` ; ${agentWords(agent, cell, zone)}`);

/** Who a member is to the reader: « Toi » for themselves. */
export const nameFor = (member: PlanningMember | undefined, me: string | null): string =>
  member === undefined ? 'Un membre' : member.id === me ? 'Toi' : member.displayName;

/**
 * The six weeks a month view reads: from the Monday of the week of the 1st, 42 days, the most the server reads. A
 * window that passes the autumn change of time lasts an hour longer than 42 days of 24 h: its end is cut back to
 * that, which takes the last hour off the last day shown, a day of the next month.
 */
export function monthWindow(month: string, zone: string): { days: string[]; from: Date; to: Date } {
  const start = mondayOf(`${month.slice(0, 7)}-01`);
  const days = Array.from({ length: CALENDAR_MAX_DAYS }, (_, index) => addDays(start, index));
  const from = zonedInstant(start, 0, zone);
  const end = zonedInstant(addDays(start, CALENDAR_MAX_DAYS), 0, zone);
  return { days, from, to: new Date(Math.min(end.getTime(), from.getTime() + CALENDAR_MAX_DAYS * DAY_MS)) };
}

/** The month itself, from its 1st to the next 1st at midnight in `zone`: what « sur novembre » sums (Extension on #431). */
export function monthBounds(month: string, zone: string): { from: Date; to: Date } {
  const first = `${month.slice(0, 7)}-01`;
  return { from: zonedInstant(first, 0, zone), to: zonedInstant(`${addMonths(month, 1)}-01`, 0, zone) };
}

/** What one day of the month says per creator: one mark per créneau, in the member's colour, the agent's, or a gap. */
export type MonthMark =
  | { readonly kind: 'shift'; readonly memberId: string }
  | { readonly kind: 'ai' }
  | { readonly kind: 'gap'; readonly ahead: boolean };

export function monthMarks(cells: readonly CalendarCell[], now: Date): MonthMark[] {
  return cells.map((cell) => {
    const [first] = cell.shifts;
    if (first !== undefined) return { kind: 'shift', memberId: first.memberId };
    if (cell.aiAlone) return { kind: 'ai' };
    return { kind: 'gap', ahead: cell.to.getTime() > now.getTime() };
  });
}

/** « novembre 2026 », the month a month view shows. */
export const monthLabel = (month: string): string =>
  new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month.slice(0, 7)}-15T12:00:00Z`),
  );

/** The month `count` months after `month` (`YYYY-MM`). */
export function addMonths(month: string, count: number): string {
  const at = new Date(`${month.slice(0, 7)}-15T12:00:00Z`);
  at.setUTCMonth(at.getUTCMonth() + count);
  return at.toISOString().slice(0, 7);
}

/** How long a member is on shift in `[from, to)`, by the ends of their shifts cut to it. */
export function minutesOn(shifts: readonly CalendarShift[], memberId: string, from: Date, to: Date): number {
  return shifts
    .filter((shift) => shift.memberId === memberId)
    .reduce((sum, shift) => {
      const start = Math.max(Date.parse(shift.startsAt), from.getTime());
      const end = Math.min(Date.parse(shift.endsAt), to.getTime());
      return end > start ? sum + (end - start) / MINUTE_MS : sum;
    }, 0);
}

/**
 * Who holds a créneau, in words, then the agent: « Kofi, 12 h – 18 h, en poste, reste 3 h 40 ; l’IA en automatique dès
 * 14 h », « libre ».
 */
export function cellWho(
  cell: CalendarCell,
  members: ReadonlyMap<string, PlanningMember>,
  me: string | null,
  zone: string,
  now: Date,
): string {
  if (cell.aiAlone) return 'l’IA seule';
  const who =
    cell.shifts.length > 0
      ? cell.shifts
          .map(
            (shift) =>
              `${nameFor(members.get(shift.memberId), me)}, ${clockAt(shift.startsAt, zone)} – ${clockAt(shift.endsAt, zone)}${phaseOf(shift, now) === 'live' ? `, en poste, ${leftOf(shift, now)}` : ''}`,
          )
          .join(' ; ')
      : cell.to.getTime() <= now.getTime()
        ? 'personne'
        : 'libre';
  return `${who}${cellAgentWords(cell.agent, cell, zone)}`;
}

/** What a créneau says out loud (CR-12, Extension 02/11): its hours when nobody's name gives them, then who. */
export function cellWords(
  cell: CalendarCell,
  members: ReadonlyMap<string, PlanningMember>,
  me: string | null,
  zone: string,
  now: Date,
): string {
  const who = cellWho(cell, members, me, zone, now);
  return cell.shifts.length > 0 && !cell.aiAlone
    ? who
    : `${clockAt(cell.from, zone)} – ${clockAt(cell.to, zone)}, ${who}`;
}

/**
 * `?vue=equipe&affichage=mois&mois=2026-11&semaine=2026-11-02`: what a Planning shows, kept in the address so that it
 * is there on return (CR-12).
 */
export interface CalendarSearch {
  readonly vue?: 'equipe' | undefined;
  readonly affichage?: 'mois' | undefined;
  readonly mois?: string | undefined;
}

export function parseCalendarSearch(search: Record<string, unknown>): CalendarSearch {
  const { vue, affichage, mois } = search;
  return {
    ...(vue === 'equipe' ? { vue } : {}),
    ...(affichage === 'mois' ? { affichage } : {}),
    ...(typeof mois === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/u.test(mois) ? { mois } : {}),
  };
}

const counted = (count: number, one: string, many: string): string =>
  count === 1 ? one : many.replace('#', String(count));

/**
 * A day of the month in words, for its button (« mercredi 28 octobre : 2 shifts, dont le tien, l’IA seule sur 1
 * créneau »): the shifts on it, wherever they start, the créneaux the agent holds alone, the ones still free.
 */
export function dayWords(
  rows: readonly CalendarRow[],
  day: string,
  me: string | null,
  now: Date,
  fill = false,
): { said: string; mine: boolean } {
  const cells = rows.flatMap((row) => row.days.get(day) ?? []);
  const shifts = new Map(
    cells
      .flatMap((cell) => cell.shifts)
      .map((shift) => [`${shift.creatorId}|${shift.memberId}|${shift.startsAt}`, shift]),
  );
  const mine = me !== null && [...shifts.values()].some((shift) => shift.memberId === me);
  const alone = cells.filter((cell) => cell.aiAlone).length;
  const free = cells.filter(
    (cell) => !cell.held && !cell.aiAlone && cell.to.getTime() > now.getTime(),
  ).length;
  const said = [
    shifts.size === 0
      ? 'aucun shift'
      : mine
        ? counted(shifts.size, 'ton shift', '# shifts, dont le tien')
        : counted(shifts.size, '1 shift', '# shifts'),
    alone === 0 ? null : counted(alone, 'l’IA seule sur 1 créneau', 'l’IA seule sur # créneaux'),
    free === 0
      ? null
      : fill
        ? counted(free, '1 créneau à pourvoir', '# créneaux à pourvoir')
        : counted(free, '1 créneau libre', '# créneaux libres'),
  ]
    .filter((part) => part !== null)
    .join(', ');
  return { said, mine };
}
