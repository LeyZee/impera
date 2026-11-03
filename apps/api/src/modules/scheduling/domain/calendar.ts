import {
  shiftSlotsOf,
  type AgentHours,
  type AgentMode,
  type CreatorId,
  type PlatformAccountId,
  type SchedulingSettings,
  type TeamMemberId,
} from '@nirvana/contracts';

import { addDays, calendarDayIn, isoWeekday, wallClockToInstant } from './time';

/**
 * The shift calendar (CR-12, ADR 0045, ADR 0048), pure: when the agent answers, which créneaux are to fill and which
 * the agent holds alone, and each member's hours. Instants in UTC; a zone only to read the créneaux and the agent's
 * slots on their clocks.
 */

export interface Span {
  readonly from: Date;
  readonly to: Date;
}

/** The agent on one creator, as `calendar_agent()` gives him. */
export interface CreatorAgent {
  readonly creatorId: CreatorId;
  readonly timeZone: string;
  readonly mode: AgentMode;
  readonly reply: AgentHours['reply'];
}

const ms = (at: Date): number => at.getTime();

/** `spans` sorted and joined where they touch or overlap. */
function merged(spans: readonly Span[]): Span[] {
  const sorted = spans
    .filter((span) => ms(span.to) > ms(span.from))
    .toSorted((a, b) => ms(a.from) - ms(b.from));
  const out: { from: Date; to: Date }[] = [];
  for (const span of sorted) {
    const last = out.at(-1);
    if (last !== undefined && ms(span.from) <= ms(last.to)) {
      if (ms(span.to) > ms(last.to)) last.to = span.to;
    } else out.push({ from: span.from, to: span.to });
  }
  return out;
}

const clip = (span: Span, window: Span): Span => ({
  from: new Date(Math.max(ms(span.from), ms(window.from))),
  to: new Date(Math.min(ms(span.to), ms(window.to))),
});

/**
 * When the agent answers on one creator within `window`, on her clock (P3-14): always, or in her active slots (one
 * that ends at or before its start ends the next day; one that ends at its start lasts the whole day). Nothing under
 * Arrêt (ADR 0048 § 1: « rien en Arrêt »). A slot keeps its wall-clock hours across a change of time.
 */
export function agentReplySpans(agent: CreatorAgent, window: Span): Span[] {
  if (agent.mode === 'stop') return [];
  if (agent.reply.mode === 'always') return [window];
  const zone = agent.timeZone;
  // A slot may start the day before the window and run into it.
  const first = addDays(calendarDayIn(window.from, zone), -1);
  const last = calendarDayIn(window.to, zone);
  const spans: Span[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) {
    const weekday = isoWeekday(day);
    for (const slot of agent.reply.slots) {
      if (!slot.enabled || slot.day !== weekday) continue;
      const endDay = slot.endMinute <= slot.startMinute ? addDays(day, 1) : day;
      spans.push(
        clip(
          {
            from: wallClockToInstant(day, slot.startMinute, zone),
            to: wallClockToInstant(endDay, slot.endMinute, zone),
          },
          window,
        ),
      );
    }
  }
  return merged(spans);
}

/** Whether `spans` (sorted, merged) cover all of `span`. */
function coversAll(spans: readonly Span[], span: Span): boolean {
  return spans.some((one) => ms(one.from) <= ms(span.from) && ms(one.to) >= ms(span.to));
}

/** An account of the grid. */
export interface GridAccount {
  readonly id: PlatformAccountId;
  readonly creatorId: CreatorId;
}

/** A shift as the grid needs it: on which account, and when. */
export interface GridShift {
  readonly platformAccountId: PlatformAccountId;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface GridSlot {
  readonly platformAccountId: PlatformAccountId;
  readonly creatorId: CreatorId;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** The stretches ahead that no shift covers, in order: never empty. */
  readonly open: readonly Span[];
}

/**
 * The créneaux of `window` at the agency's hours, day by day of its zone: each day cut from `slotStartMinute` in
 * `slotLengthMinutes`, read in wall-clock time, so that a day of a change of time has one créneau an hour longer or
 * shorter. Only those that overlap the window.
 */
export function gridSlots(
  settings: Pick<SchedulingSettings, 'timeZone' | 'slotStartMinute' | 'slotLengthMinutes'>,
  window: Span,
): Span[] {
  const zone = settings.timeZone;
  const slots = shiftSlotsOf(settings);
  const first = addDays(calendarDayIn(window.from, zone), -1);
  const last = calendarDayIn(window.to, zone);
  const out: Span[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) {
    slots.forEach((_, index) => {
      const from = wallClockToInstant(
        day,
        settings.slotStartMinute + index * settings.slotLengthMinutes,
        zone,
      );
      const to = wallClockToInstant(
        day,
        settings.slotStartMinute + (index + 1) * settings.slotLengthMinutes,
        zone,
      );
      if (ms(from) < ms(window.to) && ms(to) > ms(window.from)) out.push({ from, to });
    });
  }
  return out;
}

/** The stretches of `span` that no span of `spans` covers, in order. */
function gapsIn(span: Span, spans: readonly Span[]): Span[] {
  const gaps: Span[] = [];
  let at = ms(span.from);
  for (const one of merged(spans)) {
    if (at >= ms(span.to)) break;
    if (ms(one.to) <= at) continue;
    if (ms(one.from) > at)
      gaps.push({ from: new Date(at), to: new Date(Math.min(ms(one.from), ms(span.to))) });
    at = Math.max(at, ms(one.to));
  }
  if (at < ms(span.to)) gaps.push({ from: new Date(at), to: span.to });
  return gaps;
}

/**
 * The créneaux to fill (ADR 0045 § 2, ADR 0048 § 1), as Équipe › Planning counts them (EQ-01): on each account, each
 * créneau with a stretch ahead that no shift covers (from now, at the minute, for the créneau under way), even when a
 * shift holds the rest of it. `open` gives those stretches. One whose every open stretch the agent answers in
 * Automatique is not to fill: it goes in `aiAlone` when no shift touches it (« sans chatteur », ADR 0048 § 1), and is
 * held with its chatter otherwise (Équipe, 03/11). In Copilote it stays to fill: each draft waits for a human (ADR 0019,
 * ADR 0025).
 * The one count of the créneaux to fill: the calendar, Planning and EQ-14's departure alert read this function.
 */
export function slotsToFill(input: {
  readonly settings: Pick<SchedulingSettings, 'timeZone' | 'slotStartMinute' | 'slotLengthMinutes'>;
  readonly accounts: readonly GridAccount[];
  readonly shifts: readonly GridShift[];
  readonly agents: readonly CreatorAgent[];
  readonly window: Span;
  readonly now: Date;
}): { readonly toFill: GridSlot[]; readonly aiAlone: GridSlot[] } {
  // Planning reads « now » at the next minute, so that the stretch under way starts on a minute.
  const ahead = Math.ceil(ms(input.now) / 60_000) * 60_000;
  const slots = gridSlots(input.settings, input.window).filter((slot) => ms(slot.to) > ahead);
  const toFill: GridSlot[] = [];
  const aiAlone: GridSlot[] = [];
  const replyOf = new Map(
    input.agents.map((agent) => [
      agent.creatorId,
      agent.mode === 'auto'
        ? agentReplySpans(agent, {
            from: slots[0]?.from ?? input.window.from,
            to: slots.at(-1)?.to ?? input.window.to,
          })
        : [],
    ]),
  );
  for (const account of input.accounts) {
    const own = input.shifts
      .filter((shift) => shift.platformAccountId === account.id)
      .map((shift) => ({ from: shift.startsAt, to: shift.endsAt }));
    const reply = replyOf.get(account.creatorId) ?? [];
    for (const slot of slots) {
      const rest = { from: new Date(Math.max(ms(slot.from), ahead)), to: slot.to };
      const open = gapsIn(rest, own);
      if (open.length === 0) continue;
      const cell: GridSlot = {
        platformAccountId: account.id,
        creatorId: account.creatorId,
        startsAt: slot.from,
        endsAt: slot.to,
        open,
      };
      // The agent answering every open stretch in Automatique holds the créneau: « IA seule » when no chatter is on
      // it at all, held with the chatter otherwise (ADR 0048 § 1).
      if (open.every((gap) => coversAll(reply, gap))) {
        // Only what is left of a créneau under way: a shift already over leaves no chatter on it (Équipe, 03/11).
        const touched = own.some((shift) => ms(shift.from) < ms(rest.to) && ms(shift.to) > ms(rest.from));
        if (!touched) aiAlone.push(cell);
        continue;
      }
      toFill.push(cell);
    }
  }
  return { toFill, aiAlone };
}

/** Each member's planned minutes inside `window` (ADR 0045 § 1, the agency's view alone), largest first. */
export function workloadOf(
  shifts: readonly { readonly memberId: TeamMemberId; readonly startsAt: Date; readonly endsAt: Date }[],
  window: Span,
): { memberId: TeamMemberId; minutes: number }[] {
  const minutes = new Map<TeamMemberId, number>();
  for (const shift of shifts) {
    const inside = clip({ from: shift.startsAt, to: shift.endsAt }, window);
    const length = Math.max(0, Math.round((ms(inside.to) - ms(inside.from)) / 60_000));
    minutes.set(shift.memberId, (minutes.get(shift.memberId) ?? 0) + length);
  }
  return [...minutes]
    .map(([memberId, total]) => ({ memberId, minutes: total }))
    .toSorted((a, b) => b.minutes - a.minutes || a.memberId.localeCompare(b.memberId));
}

/** How an account was held over a window, in minutes; the four always add up to the window's length. */
export interface Coverage {
  readonly withAgent: number;
  readonly chatterAlone: number;
  readonly agentAlone: number;
  readonly nobody: number;
}

/**
 * « Couverture des comptes » (ADR 0048 § 1, the agency's alone): over `window`, the minutes an account is held by a
 * chatter with the agent answering, by a chatter alone, by the agent alone (Automatique only: in Copilote each draft
 * waits for a human, so nobody holds it), and by nobody. A week makes 168 h per account, a week of a change of time
 * 167 or 169.
 */
export function coverageOf(
  shifts: readonly Pick<GridShift, 'startsAt' | 'endsAt'>[],
  agent: CreatorAgent | null,
  window: Span,
): Coverage {
  const people = merged(shifts.map((shift) => clip({ from: shift.startsAt, to: shift.endsAt }, window)));
  const reply = agent === null ? [] : agentReplySpans(agent, window);
  const cuts = [
    ...new Set(
      [
        window.from,
        window.to,
        ...people.flatMap((s) => [s.from, s.to]),
        ...reply.flatMap((s) => [s.from, s.to]),
      ].map(ms),
    ),
  ].toSorted((a, b) => a - b);
  const counted = { withAgent: 0, chatterAlone: 0, agentAlone: 0, nobody: 0 };
  const within = (spans: readonly Span[], at: number) => spans.some((s) => ms(s.from) <= at && at < ms(s.to));
  for (let index = 0; index + 1 < cuts.length; index += 1) {
    const from = cuts[index] ?? 0;
    const to = cuts[index + 1] ?? 0;
    const minutes = Math.round((to - from) / 60_000);
    const chatter = within(people, from);
    const answering = within(reply, from);
    if (chatter && answering) counted.withAgent += minutes;
    else if (chatter) counted.chatterAlone += minutes;
    else if (answering && agent?.mode === 'auto') counted.agentAlone += minutes;
    else counted.nobody += minutes;
  }
  return counted;
}
