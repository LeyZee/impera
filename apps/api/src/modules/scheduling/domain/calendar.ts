import {
  seatsOf,
  slotWindowsOf,
  type AgentHours,
  type AgentMode,
  type CreatorId,
  type PlatformAccountId,
  type SchedulingSettings,
  type SlotWindow,
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
  /** The chatters the account wants at once on this créneau (ADR 0049 § 2): 1, or 2 where its version says so. */
  readonly seats: 1 | 2;
  /** The places to fill: `seats` less the fewest shifts at once over what is left of it, at least 1. */
  readonly places: number;
  /** The stretches ahead with fewer shifts than `seats`, in order: never empty. */
  readonly open: readonly Span[];
}

/**
 * The créneaux of `window` at the agency's hours, day by day of its zone, each day cut by the version in force
 * (`slotWindowsOf`, ADR 0049 § 1) and read in wall-clock time, so that a day of a change of time has one créneau an
 * hour longer or shorter. Only those that overlap the window.
 */
export function gridSlots(
  settings: Pick<SchedulingSettings, 'timeZone' | 'versions'>,
  window: Span,
): SlotWindow[] {
  const zone = settings.timeZone;
  const days: string[] = [];
  for (
    let day = addDays(calendarDayIn(window.from, zone), -1);
    day <= calendarDayIn(window.to, zone);
    day = addDays(day, 1)
  )
    days.push(day);
  return slotWindowsOf(settings.versions, days, (day, minute) =>
    wallClockToInstant(day, minute, zone),
  ).filter((slot) => ms(slot.from) < ms(window.to) && ms(slot.to) > ms(window.from));
}

/**
 * Over `span`, the fewest shifts of `spans` at once, and the stretches with fewer than `seats`, in order and joined.
 * Each `spans` is one shift: two that overlap hold two places (ADR 0049 § 2).
 */
function depthIn(span: Span, spans: readonly Span[], seats: number): { fewest: number; short: Span[] } {
  const inside = spans.map((one) => clip(one, span)).filter((one) => ms(one.to) > ms(one.from));
  const cuts = [
    ...new Set([span.from, span.to, ...inside.flatMap((one) => [one.from, one.to])].map(ms)),
  ].toSorted((a, b) => a - b);
  let fewest = Number.POSITIVE_INFINITY;
  const short: Span[] = [];
  for (let index = 0; index + 1 < cuts.length; index += 1) {
    const from = cuts[index] ?? 0;
    const to = cuts[index + 1] ?? 0;
    const depth = inside.filter((one) => ms(one.from) <= from && from < ms(one.to)).length;
    fewest = Math.min(fewest, depth);
    if (depth < seats) short.push({ from: new Date(from), to: new Date(to) });
  }
  return { fewest: fewest === Number.POSITIVE_INFINITY ? 0 : fewest, short: merged(short) };
}

/**
 * The créneaux to fill (ADR 0045 § 2, ADR 0048 § 1, ADR 0049 § 2), as Équipe › Planning counts them (EQ-01): on each
 * account, each créneau with a stretch ahead (from now, at the minute, for the créneau under way) that holds fewer
 * shifts than the places the account wants on it, 1 unless its version says 2 (`scheduling_slot_seats`), even when a
 * shift holds the rest of it. `open` gives those stretches, `places` how many places are to fill: one wanting two with
 * a chatter on all of it counts one (« + 2e chatteur »). One « sans chatteur » (no shift on what is left of it) whose
 * every open stretch the agent answers in Automatique is not to fill, and goes in `aiAlone` (ADR 0048 § 1), only when
 * it wants a single place: the agent never stands for a second chatter (ADR 0049 § 2). In Copilote it stays to fill:
 * each draft waits for a human (ADR 0019, ADR 0025); so does one a shift holds in part. The one count of the créneaux
 * to fill: the calendar, Planning and EQ-14's departure alert read this function.
 */
export function slotsToFill(input: {
  readonly settings: Pick<SchedulingSettings, 'timeZone' | 'versions'>;
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
      const seats = seatsOf(slot.version, slot.rank, account.id);
      const { fewest, short: open } = depthIn(rest, own, seats);
      if (open.length === 0) continue;
      const cell: GridSlot = {
        platformAccountId: account.id,
        creatorId: account.creatorId,
        startsAt: slot.from,
        endsAt: slot.to,
        seats,
        places: seats - fewest,
        open,
      };
      // « IA seule » only « sans chatteur » (ADR 0048 § 1): no shift on what is left of the créneau (one already over
      // leaves no chatter on it), a single place wanted (ADR 0049 § 2), and the agent answers every open stretch in
      // Automatique. A créneau a chatter holds in part stays to fill, the agent answering the rest or not, as Planning
      // shows it: a hole is never hidden.
      const touched = own.some((shift) => ms(shift.from) < ms(rest.to) && ms(shift.to) > ms(rest.from));
      (seats === 1 && !touched && open.every((gap) => coversAll(reply, gap)) ? aiAlone : toFill).push(cell);
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
