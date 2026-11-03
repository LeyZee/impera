import {
  CALENDAR_MAX_DAYS,
  shiftSlotsOf,
  type Calendar,
  type CalendarAgent,
  type CalendarShift,
  type PlanningMember,
} from '@nirvana/contracts';

import { addDays, clockAt, clockOf, mondayOf, zonedInstant } from './time';

/**
 * Équipe › Calendrier as the screens draw it (CR-12, ADR 0045 § 1, ADR 0048): each creator's day cut into the agency's
 * créneaux, who is on each, and the agent written in words. The server reads the agent's hours on her clock
 * (`answers`); this file only crosses them with the créneaux, so that no hour is read on a clock twice.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

interface Span {
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
  /** The shifts that start in this créneau (one that starts before the first créneau of the day goes to it). */
  readonly shifts: readonly CalendarShift[];
  /** A shift covers part of it, whatever créneau it starts in. */
  readonly held: boolean;
  /** `null` when he does not answer in it, or under Arrêt. */
  readonly agent: AgentInSlot | null;
  /** No chatter on what is left of it and the agent answers all of it in Automatique (ADR 0048 § 1). */
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
 * Each creator's days cut into the agency's créneaux (`settings`), from `days` (calendar days in the agency's zone).
 * A créneau ends where the next starts, in wall-clock time: the night of a change of time has one an hour longer or
 * shorter. `now` decides what is left of a créneau under way.
 */
export function calendarRows(calendar: Calendar, days: readonly string[], now: Date): CalendarRow[] {
  const { settings } = calendar;
  const zone = settings.timeZone;
  const slots = shiftSlotsOf(settings);
  const length = settings.slotLengthMinutes;
  const ahead = Math.ceil(now.getTime() / MINUTE_MS) * MINUTE_MS;
  const windows = days.map((day) => ({
    day,
    cuts: slots.map((_, index) => ({
      from: zonedInstant(day, settings.slotStartMinute + index * length, zone).getTime(),
      to: zonedInstant(day, settings.slotStartMinute + (index + 1) * length, zone).getTime(),
    })),
  }));
  const first = windows[0]?.cuts[0]?.from ?? 0;
  return calendar.creators.map((creator) => {
    const agent = calendar.agent.find((one) => one.creatorId === creator.id) ?? null;
    const answers = agent === null || agent.mode === 'stop' ? [] : spansOf(agent.answers);
    const theirs = calendar.shifts.filter((shift) => shift.creatorId === creator.id);
    const spans = spansOf(theirs);
    const cells = new Map<string, CalendarCell[]>();
    for (const { day, cuts } of windows) {
      cells.set(
        day,
        cuts.map((cut) => {
          // The créneaux of the window follow each other without a hole: a shift goes to the one its start falls in,
          // and one that started before the window to the first.
          const opening = cut.from === first ? Number.NEGATIVE_INFINITY : cut.from;
          const starting = theirs.filter((shift) => {
            const start = Date.parse(shift.startsAt);
            return start >= opening && start < cut.to;
          });
          const part = agent === null || agent.mode === 'stop' ? null : coveredPart(answers, cut);
          const rest = { from: Math.max(cut.from, ahead), to: cut.to };
          const onRest = spans.some((span) => span.from < rest.to && span.to > rest.from);
          return {
            from: new Date(cut.from),
            to: new Date(cut.to),
            shifts: starting,
            held: spans.some((span) => span.from < cut.to && span.to > cut.from),
            agent:
              part === null || agent === null || agent.mode === 'stop'
                ? null
                : {
                    mode: agent.mode,
                    full: coversAll(answers, cut),
                    from: new Date(part.from),
                    to: new Date(part.to),
                  },
            aiAlone: agent?.mode === 'auto' && rest.to > rest.from && !onRest && coversAll(answers, rest),
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
      : `${clockOf(only.startMinute)} – ${clockOf(only.endMinute)}`;
  return `IA ${mode} · ${hours}${days}`;
}

/** The words a créneau says to a screen reader, the agent included (« Kofi, 12 h – 18 h ; l’IA en automatique dès 14 h »). */
export function cellAgentWords(
  agent: AgentInSlot | null,
  cell: Pick<CalendarCell, 'from' | 'to'>,
  zone: string,
): string {
  if (agent === null) return '';
  const mode = MODE_WORD[agent.mode];
  if (agent.full) return ` ; l’IA en ${mode}`;
  return agent.from.getTime() > cell.from.getTime()
    ? ` ; l’IA en ${mode} dès ${clockAt(agent.from, zone)}`
    : ` ; l’IA en ${mode} jusqu’à ${clockAt(agent.to, zone)}`;
}

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
    return { kind: 'gap', ahead: !cell.held && cell.to.getTime() > now.getTime() };
  });
}
