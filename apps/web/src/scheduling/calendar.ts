import {
  CALENDAR_MAX_DAYS,
  slotWindowsOf,
  type Calendar,
  type CalendarAgent,
  type CalendarShift,
  type CalendarSlot,
  type PlanningMember,
} from '@impera/contracts';

import { leftOf, phaseOf, unheldReader, type Unheld } from './model';
import { addDays, clockAt, clockOf, mondayOf, zonedInstant } from './time';

import { parsePlanningSearch, unheldLabel, type PlanningSearch } from '@/screens/team/model';

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

/** A shift in a créneau, and why nobody holds it when nobody does: the agency's alone (recette EQP-03, EQU-01). */
export interface CellShift extends CalendarShift {
  readonly unheld: Unheld | null;
}

/** What is left of a créneau to fill: for the agency, the server's count (`agency.toFill`, ADR 0049 § 2). */
export interface CellToFill {
  /** Its stretches ahead with a place free, in order, from the minute under way. */
  readonly open: readonly Span[];
  /** The places to fill: two on a créneau that wants two and has nobody. */
  readonly places: number;
  /** The first of two places is held: a second chatter is wanted. */
  readonly second: boolean;
}

export interface CalendarCell {
  readonly from: Date;
  readonly to: Date;
  /**
   * The shifts that cover part of it, wherever they start, with their own hours: a shift across two créneaux is drawn
   * on both (ADR 0049 § 1); the month marks the créneau with the first one held.
   */
  readonly shifts: readonly CellShift[];
  /** A shift its member holds covers part of it. */
  readonly held: boolean;
  /** `null` when he does not answer in it, or under Arrêt. */
  readonly agent: AgentInSlot | null;
  /** No chatter on what is left of it (all of it, once gone by) and the agent answers that in Automatique (ADR 0048 § 1). */
  readonly aiAlone: boolean;
  /** Her creator is archived (ADR 0071 § 2): the row is her history, nothing of it is free or to fill, even ahead. */
  readonly closed: boolean;
  /**
   * What is left of it to fill, `null` when nothing is. For the agency, the server's count, as Planning reads it: a
   * créneau held in part keeps its hole, a shift nobody holds covers nothing, a second place counts (recette EQU-02).
   * For a member, who cannot fill it, a créneau ahead nobody is on: « libre ».
   */
  readonly toFill: CellToFill | null;
}

export interface CalendarRow {
  readonly creator: Calendar['creators'][number];
  readonly agent: CalendarAgent | null;
  readonly days: ReadonlyMap<string, readonly CalendarCell[]>;
}

/** A row on a day of the month: always, but an archived creator's only on the days of her shifts (ADR 0071 § 2). */
export const shownOn = (row: CalendarRow, day: string): boolean =>
  !row.creator.archived || (row.days.get(day) ?? []).some((cell) => cell.shifts.length > 0);

const spansOf = (list: readonly { readonly startsAt: string; readonly endsAt: string }[]): Span[] =>
  list.map((one) => ({ from: Date.parse(one.startsAt), to: Date.parse(one.endsAt) }));

/** The next minute, where what is ahead starts (the server's `slotsToFill` rounds the same way). */
const aheadOf = (now: Date): number => Math.ceil(now.getTime() / MINUTE_MS) * MINUTE_MS;

/** A créneau ahead nobody is on, for a member: all that is left of it, « libre ». */
function freeOf(cut: Span, taken: boolean, now: Date): CellToFill | null {
  const from = Math.max(cut.from, aheadOf(now));
  return taken || from >= cut.to ? null : { open: [{ from, to: cut.to }], places: 1, second: false };
}

/**
 * The server's créneaux to fill that start with `cut`, on any of the creator's accounts, as one: their stretches
 * joined and cut to what is still ahead, the most places any of them wants.
 */
function toFillAt(slots: readonly CalendarSlot[], cut: Span, now: Date): CellToFill | null {
  const here = slots.filter((slot) => Date.parse(slot.startsAt) === cut.from);
  const ahead = aheadOf(now);
  const open: Span[] = [];
  const stretches = here
    .flatMap((slot) => spansOf(slot.open))
    .map((gap) => ({ from: Math.max(gap.from, ahead), to: gap.to }))
    .filter((gap) => gap.to > gap.from)
    .toSorted((a, b) => a.from - b.from);
  for (const gap of stretches) {
    const last = open.at(-1);
    if (last !== undefined && gap.from <= last.to)
      open[open.length - 1] = { from: last.from, to: Math.max(last.to, gap.to) };
    else open.push(gap);
  }
  if (open.length === 0) return null;
  return {
    open,
    places: Math.max(...here.map((slot) => slot.places)),
    second: here.every((slot) => slot.seats === 2 && slot.places === 1),
  };
}

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
 * The lines a week cut into créneaux takes: the most créneaux any day of any row has, so that a version which adds one
 * mid-week (ADR 0049 § 1) gets its line from the first day, the subgrid adding none.
 */
export function slotLinesOf(rows: Iterable<ReadonlyMap<string, readonly unknown[]> | null>): number {
  let lines = 0;
  for (const days of rows) for (const cells of days?.values() ?? []) lines = Math.max(lines, cells.length);
  return lines;
}

/**
 * Each creator's days cut into the agency's créneaux (`settings`), from `days` (calendar days in the agency's zone).
 * A créneau ends where the next starts, in wall-clock time: the night of a change of time has one an hour longer or
 * shorter. `now` decides what is left of a créneau under way.
 */
export function calendarRows(calendar: Calendar, days: readonly string[], now: Date): CalendarRow[] {
  const { settings } = calendar;
  const zone = settings.timeZone;
  // Each day cut by the version in force (ADR 0049 § 1): a week can change créneaux on one of its days.
  const all = slotWindowsOf(settings.versions, days, (day, minute) => zonedInstant(day, minute, zone));
  const windows = days.map((day) => ({
    day,
    cuts: all
      .filter((window) => window.day === day)
      .map((window) => ({ from: window.from.getTime(), to: window.to.getTime() })),
  }));
  // The creators one plans first, an archived one's history after them (ADR 0071 § 2).
  const creators = [...calendar.creators].sort((a, b) => Number(a.archived) - Number(b.archived));
  // Who holds none of his shifts, for the agency (recette EQU-01, EQU-02): those shifts are drawn, and cover nothing.
  const unheld = unheldReader(calendar, now);
  return creators.map((creator) => {
    const agent = calendar.agent.find((one) => one.creatorId === creator.id) ?? null;
    const theirs = calendar.shifts
      .filter((shift) => shift.creatorId === creator.id)
      .map((shift): CellShift => ({ ...shift, unheld: unheld(shift) }));
    const spans = spansOf(theirs.filter((shift) => shift.unheld === null));
    // The agency fills from the server's count, the one Planning reads (ADR 0049 § 2); a member reads what is free.
    const slots = calendar.agency?.toFill.filter((slot) => slot.creatorId === creator.id) ?? null;
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
          const held = over.some((shift) => shift.unheld === null);
          return {
            from: new Date(cut.from),
            to: new Date(cut.to),
            shifts: over,
            held,
            agent: inSlot,
            aiAlone,
            closed: creator.archived,
            toFill:
              slots === null
                ? freeOf(cut, held || aiAlone || creator.archived, now)
                : toFillAt(slots, cut, now),
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

export function monthMarks(cells: readonly CalendarCell[]): MonthMark[] {
  return cells.map((cell) => {
    // A shift nobody holds marks nothing: its créneau reads to fill, as in the week (recette EQU-02).
    const first = cell.shifts.find((shift) => shift.unheld === null);
    if (first !== undefined) return { kind: 'shift', memberId: first.memberId };
    if (cell.aiAlone) return { kind: 'ai' };
    return { kind: 'gap', ahead: cell.toFill !== null };
  });
}

/**
 * What the month's marks stand for, under the calendar: « Un trait par créneau : 0 h, 6 h, 12 h et 18 h » when every
 * day shown has the same créneaux, said without hours when a new version changes them within the month (GES-12).
 */
export function monthMarksKey(calendar: Calendar, days: readonly string[]): string {
  const zone = calendar.settings.timeZone;
  const windows = slotWindowsOf(calendar.settings.versions, days, (day, minute) =>
    zonedInstant(day, minute, zone),
  );
  const starts = new Set(
    days.map((day) =>
      windows
        .filter((window) => window.day === day)
        .map((window) => clockOf(window.slot.startMinute))
        .join(', '),
    ),
  );
  const [only] = starts;
  if (starts.size !== 1 || only === undefined || only === '')
    return 'Un trait par créneau de la journée, dans l’ordre';
  const last = only.lastIndexOf(', ');
  return `Un trait par créneau : ${last === -1 ? only : `${only.slice(0, last)} et ${only.slice(last + 2)}`}`;
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
 * What is left to fill of a créneau, in words: « à pourvoir », « à pourvoir de 14 h à 18 h » when a shift holds the
 * rest, « 2e chatteur à pourvoir », « à pourvoir, 2 places »; « libre » for a reader who cannot fill it (CR-12).
 */
function toFillWords(cell: CalendarCell, toFill: CellToFill, zone: string, now: Date, fill: boolean): string {
  if (!fill) return 'libre';
  const what = toFill.second
    ? '2e chatteur à pourvoir'
    : toFill.places === 2
      ? 'à pourvoir, 2 places'
      : 'à pourvoir';
  const [only] = toFill.open;
  const rest = Math.max(cell.from.getTime(), aheadOf(now));
  if (toFill.open.length === 1 && only !== undefined && only.from <= rest && only.to >= cell.to.getTime()) {
    return what;
  }
  const hours = toFill.open.map(
    (gap) => `de ${clockAt(new Date(gap.from), zone)} à ${clockAt(new Date(gap.to), zone)}`,
  );
  return `${what} ${hours.join(' et ')}`;
}

/** A piece of what a créneau says: `unheld` for a status that keeps a member from holding it, said in amber. */
export interface WhoPart {
  readonly text: string;
  readonly unheld: boolean;
}

/**
 * Who holds a créneau, in words, then what is left to fill and the agent: « Kofi, 12 h – 18 h, en poste, reste 3 h 40 ;
 * l’IA en automatique dès 14 h », « Théo, 16 h – 22 h, suspendu ; à pourvoir », « à pourvoir », « libre ». `fill`: the
 * reader can fill it (the agency). In pieces, so that the day's detail marks « suspendu » or « sans accès » in amber, as
 * the week does (Design, 16/11).
 */
export function cellWhoParts(
  cell: CalendarCell,
  members: ReadonlyMap<string, PlanningMember>,
  me: string | null,
  zone: string,
  now: Date,
  fill = false,
): WhoPart[] {
  if (cell.aiAlone) return [{ text: 'l’IA seule', unheld: false }];
  const parts: WhoPart[] = [];
  const say = (text: string, unheld = false): void => {
    if (text !== '') parts.push({ text, unheld });
  };
  cell.shifts.forEach((shift, index) => {
    say(
      `${index === 0 ? '' : ' ; '}${nameFor(members.get(shift.memberId), me)}, ${clockAt(shift.startsAt, zone)} – ${clockAt(shift.endsAt, zone)}`,
    );
    if (shift.unheld !== null) {
      say(', ');
      say(unheldLabel(shift.unheld).toLowerCase(), true);
    } else if (phaseOf(shift, now) === 'live') say(`, en poste, ${leftOf(shift, now)}`);
  });
  const open = cell.toFill === null ? null : toFillWords(cell, cell.toFill, zone, now, fill);
  if (open !== null) say(`${parts.length === 0 ? '' : ' ; '}${open}`);
  if (parts.length === 0) say('personne');
  say(cellAgentWords(cell.agent, cell, zone));
  return parts;
}

/** `cellWhoParts` as one sentence, for a label read aloud. */
export function cellWho(
  cell: CalendarCell,
  members: ReadonlyMap<string, PlanningMember>,
  me: string | null,
  zone: string,
  now: Date,
  fill = false,
): string {
  return cellWhoParts(cell, members, me, zone, now, fill)
    .map((part) => part.text)
    .join('');
}

/** What a créneau says out loud (CR-12, Extension 02/11): its hours when nobody's name gives them, then who. */
export function cellWords(
  cell: CalendarCell,
  members: ReadonlyMap<string, PlanningMember>,
  me: string | null,
  zone: string,
  now: Date,
  fill = false,
): string {
  const who = cellWho(cell, members, me, zone, now, fill);
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

/** Each key said, `undefined` when thrown away, so that a broken one never reaches the page (recette CHT-06). */
export function parseCalendarSearch(search: Record<string, unknown>): CalendarSearch {
  const { vue, affichage, mois } = search;
  return {
    vue: vue === 'equipe' ? vue : undefined,
    affichage: affichage === 'mois' ? affichage : undefined,
    mois: typeof mois === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/u.test(mois) ? mois : undefined,
  };
}

/** `/equipe/planning`: the planning's keys and the calendar's, each one said (recette CHT-06). */
export function teamPlanningSearch(search: Record<string, unknown>): PlanningSearch & CalendarSearch {
  return { ...parsePlanningSearch(search), ...parseCalendarSearch(search) };
}

/** `/planning`, a member's own: their week and the calendar's keys, each one said, never a member. */
export function myPlanningSearch(
  search: Record<string, unknown>,
): CalendarSearch & { readonly semaine?: string | undefined } {
  return { semaine: parsePlanningSearch(search).semaine, ...parseCalendarSearch(search) };
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
  const free = cells.filter((cell) => cell.toFill !== null).length;
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
