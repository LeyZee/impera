import { z } from 'zod';

import { CreatorIdSchema } from './ids';
import { MinuteOfDaySchema } from './scheduling';

/**
 * When the agent may answer and follow up, creator by creator (P3-14), on her clock (`creators.timezone`). Stored in
 * `creators.agent_hours`; `null` reads as `DEFAULT_AGENT_HOURS`, today's behaviour. Out of her reply slots she keeps
 * the messages and answers them when the next one opens; in her quiet hours nobody gets a follow-up; the night range
 * is when the Nuit scripts apply.
 */

const MINUTES_PER_DAY = 1440;

/** A range of minutes on her clock; one that ends at or before its start ends the next day. Never a whole day. */
export const MinuteRangeSchema = z
  .object({ startMinute: MinuteOfDaySchema, endMinute: MinuteOfDaySchema })
  .refine((range) => range.startMinute !== range.endMinute, {
    message: 'Une plage doit commencer et finir à des heures différentes',
    path: ['endMinute'],
  });
export type MinuteRange = z.infer<typeof MinuteRangeSchema>;

/** ISO day of the week: 1 is Monday, 7 is Sunday. */
export const IsoDaySchema = z.number().int().min(1).max(7);

/**
 * A reply slot on one day; one that ends before its start ends the next day (« jusqu'au lendemain »), one that ends
 * at its start lasts a whole day (« toute la journée »).
 */
export const AgentSlotSchema = z.object({
  day: IsoDaySchema,
  startMinute: MinuteOfDaySchema,
  endMinute: MinuteOfDaySchema,
  /** Switched off without being deleted. */
  enabled: z.boolean(),
});
export type AgentSlot = z.infer<typeof AgentSlotSchema>;

export const AGENT_SLOTS_MAX = 28;

/** Where a slot sits in the week, in minutes from Monday 00:00: its end may pass Sunday night. */
const weekSpan = (slot: AgentSlot): { readonly from: number; readonly to: number } => {
  const from = (slot.day - 1) * MINUTES_PER_DAY + slot.startMinute;
  const length = (slot.endMinute - slot.startMinute + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
  return { from, to: from + length };
};

const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
const NBSP = '\u00a0';

/** « 9 h », « 9 h 30 », with the spaces the planning uses. */
const clockWords = (minute: number): string => {
  const m = minute % 60;
  return `${String(Math.floor(minute / 60))}${NBSP}h${m === 0 ? '' : `${NBSP}${String(m).padStart(2, '0')}`}`;
};

/** « le créneau du lundi, 9 h – 1 h », or « toute la journée ». */
const slotWords = (slot: AgentSlot): string =>
  `le créneau du ${DAY_NAMES[slot.day - 1] ?? ''}, ${
    slot.startMinute === slot.endMinute
      ? 'toute la journée'
      : `${clockWords(slot.startMinute)}${NBSP}–${NBSP}${clockWords(slot.endMinute)}`
  }`;

const WEEK_MINUTES = 7 * MINUTES_PER_DAY;

/** Two spans of the week overlap, the week read as a circle (Sunday night into Monday). */
const overlap = (a: { from: number; to: number }, b: { from: number; to: number }): boolean =>
  [-WEEK_MINUTES, 0, WEEK_MINUTES].some((shift) => a.from < b.to + shift && b.from + shift < a.to);

const ReplyHoursSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('always') }),
  z
    .object({ mode: z.literal('slots'), slots: z.array(AgentSlotSchema).max(AGENT_SLOTS_MAX) })
    // Cutting everything is the kill switch's job (Arrêt), not a setting of hours.
    .refine((reply) => reply.slots.some((slot) => slot.enabled), {
      message: 'Au moins un créneau actif ; pour tout couper, c’est l’arrêt',
      path: ['slots'],
    })
    // One issue per pair, on the later slot, at its index in the list: the screen marks the line and names the other.
    .superRefine((reply, context) => {
      const active = reply.slots.flatMap((slot, index) => (slot.enabled ? [{ slot, index }] : []));
      active.forEach((later, j) => {
        const earlier = active
          .slice(0, j)
          .find((other) => overlap(weekSpan(other.slot), weekSpan(later.slot)));
        if (earlier === undefined) return;
        context.addIssue({
          code: 'custom',
          message: `Chevauche ${slotWords(earlier.slot)}`,
          path: ['slots', later.index, 'startMinute'],
        });
      });
    }),
]);

export const AgentHoursSchema = z.object({
  /** When she may answer: always (today's behaviour), or in her slots. */
  reply: ReplyHoursSchema,
  /** Her quiet hours: no follow-up then, even in an open slot. */
  followUpQuiet: MinuteRangeSchema,
  /** Her night: when the Nuit scripts apply. */
  night: MinuteRangeSchema,
});
export type AgentHours = z.infer<typeof AgentHoursSchema>;

/** Without a setting: always open, quiet from 23:00 to 9:00, night from 22:00 to 7:00, as before P3-14. */
export const DEFAULT_AGENT_HOURS: AgentHours = {
  reply: { mode: 'always' },
  followUpQuiet: { startMinute: 23 * 60, endMinute: 9 * 60 },
  night: { startMinute: 22 * 60, endMinute: 7 * 60 },
};

/** What the screen offers when the owner switches to slots: 9:00 to 1:00 every day. */
export const SUGGESTED_REPLY_SLOTS: readonly AgentSlot[] = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
  day,
  startMinute: 9 * 60,
  endMinute: 60,
  enabled: true,
}));

/** Her day of the week and minute of the day at `at`, by `Intl` only. */
export function localClock(at: Date, timeZone: string): { readonly day: number; readonly minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(part('weekday')) + 1;
  return { day, minute: Number(part('hour')) * 60 + Number(part('minute')) };
}

/** `minute` falls in `range`, on her clock. */
export function inMinuteRange(range: MinuteRange, minute: number): boolean {
  return range.startMinute < range.endMinute
    ? minute >= range.startMinute && minute < range.endMinute
    : minute >= range.startMinute || minute < range.endMinute;
}

/** The active slot she is in at `at`, on her clock. */
function slotAt(hours: AgentHours, timeZone: string, at: Date): AgentSlot | undefined {
  if (hours.reply.mode === 'always') return undefined;
  const clock = localClock(at, timeZone);
  const week = (clock.day - 1) * MINUTES_PER_DAY + clock.minute;
  return hours.reply.slots
    .filter((slot) => slot.enabled)
    .find((slot) => {
      const span = weekSpan(slot);
      return [0, WEEK_MINUTES].some((shift) => week + shift >= span.from && week + shift < span.to);
    });
}

/** Her week type alone: always, or inside one of her active slots, on her clock. */
function weekOpenAt(hours: AgentHours, timeZone: string, at: Date): boolean {
  return hours.reply.mode === 'always' || slotAt(hours, timeZone, at) !== undefined;
}

/** Her dated exceptions as the agent reads them (ADR 0148 § 3): a date of her clock and its ranges. */
export type DatedRanges = readonly { readonly date: string; readonly ranges: readonly DayRange[] }[];

/**
 * She may answer at `at`, on her clock: a date with an exception (ADR 0148 § 3) follows its ranges alone, a slot of
 * the day before that runs past midnight included; any other date follows her week, always or in her active slots,
 * but for a slot started on a date with an exception, which stops at that date's midnight. The switches (Arrêt, pause, global) are read elsewhere, before this.
 */
export function replyOpenAt(
  hours: AgentHours,
  timeZone: string,
  at: Date,
  exceptions: DatedRanges = [],
): boolean {
  if (exceptions.length > 0) {
    const date = localDate(at, timeZone);
    const exception = exceptions.find((candidate) => candidate.date === date);
    if (exception !== undefined) {
      const { minute } = localClock(at, timeZone);
      return exception.ranges.some((range) => minute >= range.startMinute && minute < range.endMinute);
    }
    // A slot belongs to the day it starts: one that starts on a date with an exception does not run past its midnight.
    const slot = slotAt(hours, timeZone, at);
    if (slot !== undefined && slot.day !== localClock(at, timeZone).day) {
      // The calendar day before hers, not the instant minute + 1 earlier: the night the clock goes back, 2:30 the
      // second time is three hours and a half after midnight (relecture Agent de #865).
      const dayBefore = new Date(
        Date.parse(`${localDate(at, timeZone)}T00:00:00Z`) - MINUTES_PER_DAY * MINUTE_MS,
      )
        .toISOString()
        .slice(0, 10);
      if (exceptions.some((candidate) => candidate.date === dayBefore)) return false;
    }
  }
  return weekOpenAt(hours, timeZone, at);
}

/** Her quiet hours hold at `at`: no follow-up then. */
export function followUpQuietAt(hours: AgentHours, timeZone: string, at: Date): boolean {
  return inMinuteRange(hours.followUpQuiet, localClock(at, timeZone).minute);
}

/** It is her night at `at`: the Nuit scripts apply. */
export function nightAt(hours: AgentHours, timeZone: string, at: Date): boolean {
  return inMinuteRange(hours.night, localClock(at, timeZone).minute);
}

const MINUTE_MS = 60_000;

/**
 * The first instant at or after `after` whose minute on her clock is `minute`: an hour of a clock change that does
 * not exist (2:30 the last Sunday of March in Paris) lands on the first minute after it.
 */
function nextWallMinute(after: Date, timeZone: string, minute: number): Date {
  const wall = (at: Date): number => localClock(at, timeZone).minute;
  const ahead = (minute - wall(after) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  let at = new Date(Math.floor(after.getTime() / MINUTE_MS) * MINUTE_MS + ahead * MINUTE_MS);
  // A clock change on the way shifts the landing by its offset: one correction puts it back on her clock.
  const drift = (minute - wall(at) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  if (drift !== 0) {
    at = new Date(at.getTime() + (drift > MINUTES_PER_DAY / 2 ? drift - MINUTES_PER_DAY : drift) * MINUTE_MS);
  }
  // Still not that minute: it does not exist that day. Walk to the first minute past the jump (an hour at most).
  for (let i = 0; i < 120 && wall(at) !== minute; i += 1) {
    if ((wall(at) - minute + MINUTES_PER_DAY) % MINUTES_PER_DAY < MINUTES_PER_DAY / 2) break;
    at = new Date(at.getTime() + MINUTE_MS);
  }
  return at.getTime() < after.getTime() ? after : at;
}

/**
 * When she may answer next: `after` itself when she is open, otherwise the next opening, on her clock. Without
 * exceptions, the opening of her next active slot; never null: a setting in slots always has one active. With
 * exceptions, an opening is a slot's start, a range's start or a midnight (a date entering or leaving its exception):
 * the earliest of those, over the next eight days, at which she is open; `after` when none is (a week closed by hand).
 */
export function nextReplyOpening(
  hours: AgentHours,
  timeZone: string,
  after: Date,
  exceptions: DatedRanges = [],
): Date {
  if (replyOpenAt(hours, timeZone, after, exceptions)) return after;
  if (exceptions.length === 0 && hours.reply.mode === 'always') return after;
  const starts = openingMinutes(hours, exceptions);
  let best: Date | undefined;
  // Each start minute, on each of the next eight days: the earliest one that opens.
  for (const start of starts) {
    let from = after;
    for (let i = 0; i < 8; i += 1) {
      const at = nextWallMinute(from, timeZone, start);
      if (best !== undefined && at >= best) break;
      if (replyOpenAt(hours, timeZone, at, exceptions)) best = at;
      from = new Date(at.getTime() + MINUTE_MS);
    }
  }
  return best ?? after;
}

/** The minutes of her clock where she can open: her slots' starts, and with exceptions their ranges' and midnight. */
function openingMinutes(hours: AgentHours, exceptions: DatedRanges): number[] {
  const slots = hours.reply.mode === 'slots' ? hours.reply.slots.filter((slot) => slot.enabled) : [];
  const minutes = slots.map((slot) => slot.startMinute);
  if (exceptions.length > 0) {
    minutes.push(0, ...exceptions.flatMap((exception) => exception.ranges.map((range) => range.startMinute)));
  }
  return [...new Set(minutes)];
}

/** The last instant at or before `before` whose minute on her clock is `minute` (the day before, when not yet today). */
function previousWallMinute(before: Date, timeZone: string, minute: number): Date {
  let at = nextWallMinute(new Date(before.getTime() - 26 * 60 * MINUTE_MS), timeZone, minute);
  for (let i = 0; i < 2; i += 1) {
    const next = nextWallMinute(new Date(at.getTime() + MINUTE_MS), timeZone, minute);
    if (next.getTime() > before.getTime()) break;
    at = next;
  }
  return at;
}

/**
 * When the open stretch she is in at `at` began: slots that follow one another read as one stretch. `null` when
 * closed; the epoch when she is always open. The « Sans réponse » net counts from there, not from his message. With
 * exceptions: the latest opening minute (`openingMinutes`) at or before `at`, over the last eight days, where she is
 * open and was not a minute before; the epoch when none (always open, around a date she keeps open).
 */
export function replyOpenedAt(
  hours: AgentHours,
  timeZone: string,
  at: Date,
  exceptions: DatedRanges = [],
): Date | null {
  if (!replyOpenAt(hours, timeZone, at, exceptions)) return null;
  if (exceptions.length === 0) return weekOpenedAt(hours, timeZone, at);
  let latest: Date | null = null;
  for (const start of openingMinutes(hours, exceptions)) {
    let before = at;
    for (let i = 0; i < 8; i += 1) {
      const candidate = previousWallMinute(before, timeZone, start);
      if (latest !== null && candidate <= latest) break;
      const opens =
        replyOpenAt(hours, timeZone, candidate, exceptions) &&
        !replyOpenAt(hours, timeZone, new Date(candidate.getTime() - MINUTE_MS), exceptions);
      if (opens) {
        latest = candidate;
        break;
      }
      before = new Date(candidate.getTime() - MINUTE_MS);
    }
  }
  return latest ?? new Date(0);
}

/** `replyOpenedAt` on her week alone. */
function weekOpenedAt(hours: AgentHours, timeZone: string, at: Date): Date | null {
  if (hours.reply.mode === 'always') return new Date(0);
  let opened = at;
  // A slot lasts less than a day, so its start is the last time her clock showed it; then the slot just before.
  for (let i = 0; i <= AGENT_SLOTS_MAX; i += 1) {
    const slot = slotAt(hours, timeZone, opened);
    if (slot === undefined) return opened;
    opened = previousWallMinute(opened, timeZone, slot.startMinute);
    const before = new Date(opened.getTime() - MINUTE_MS);
    if (!weekOpenAt(hours, timeZone, before)) return opened;
    opened = before;
  }
  return opened;
}

/**
 * When a follow-up may go out next: the first minute both in an open slot and out of her quiet hours. `null` when no
 * minute of the week is both (slots from 23:00 to 1:00 with quiet hours from 23:00 to 9:00): no follow-up then.
 */
export function nextFollowUpAllowed(
  hours: AgentHours,
  timeZone: string,
  after: Date,
  exceptions: DatedRanges = [],
): Date | null {
  let at = after;
  // Each step moves to an opening or past the quiet hours, about two a day; bounded in time too: past a week and a
  // day of her clock, no minute will ever allow one.
  const horizon = after.getTime() + 8 * MINUTES_PER_DAY * MINUTE_MS;
  for (let i = 0; i < 4 * AGENT_SLOTS_MAX + 8 && at.getTime() <= horizon; i += 1) {
    if (!replyOpenAt(hours, timeZone, at, exceptions)) {
      const opening = nextReplyOpening(hours, timeZone, at, exceptions);
      // Closed with no opening ahead (a week of dates closed by hand): no follow-up.
      if (opening.getTime() === at.getTime()) return null;
      at = opening;
    } else if (followUpQuietAt(hours, timeZone, at))
      at = nextWallMinute(at, timeZone, hours.followUpQuiet.endMinute);
    else return at;
  }
  return null;
}

/** `GET /v1/creators/:id/agent-hours` (P3-14): her hours as the agent reads them, on her clock. */
export const AgentHoursViewSchema = z.object({
  hours: AgentHoursSchema,
  /** `hours` are `DEFAULT_AGENT_HOURS`: no setting stored, or one that no longer reads (`invalidStored`). */
  isDefault: z.boolean(),
  /**
   * A setting is stored but no longer passes `AgentHoursSchema` (a rule of the contract hardened since): the agent
   * follows the defaults, and the screen says so instead of a quiet « Par défaut ».
   */
  invalidStored: z.boolean(),
  /** Her clock (`creators.timezone`): every minute above is read on it. */
  timeZone: z.string().min(1),
});
export type AgentHoursView = z.infer<typeof AgentHoursViewSchema>;

/** `PUT /v1/creators/:id/agent-hours`: her hours, or `null` to go back to the defaults. */
export const SetAgentHoursBodySchema = z.object({ hours: AgentHoursSchema.nullable() });
export type SetAgentHoursBody = z.infer<typeof SetAgentHoursBodySchema>;

/** A date on her clock, « 2026-11-20 ». */
export const LocalDateSchema = z.iso.date();
export type LocalDate = z.infer<typeof LocalDateSchema>;

/** A range inside one day of her clock: from `startMinute` to `endMinute`, 1440 being midnight at its end. */
export const DayRangeSchema = z
  .object({ startMinute: MinuteOfDaySchema, endMinute: z.number().int().min(1).max(MINUTES_PER_DAY) })
  .refine((range) => range.startMinute < range.endMinute, {
    message: 'Une plage doit finir après son début',
    path: ['endMinute'],
  });
export type DayRange = z.infer<typeof DayRangeSchema>;

export const AGENT_EXCEPTION_RANGES_MAX = 8;

const DayRangesSchema = z
  .array(DayRangeSchema)
  .max(AGENT_EXCEPTION_RANGES_MAX)
  // One issue per pair, on the later range: two ranges of the same day never overlap (the screen joins them).
  .superRefine((ranges, context) => {
    ranges.forEach((later, j) => {
      const earlier = ranges
        .slice(0, j)
        .find((other) => other.startMinute < later.endMinute && later.startMinute < other.endMinute);
      if (earlier === undefined) return;
      context.addIssue({
        code: 'custom',
        message: `Chevauche la plage ${clockWords(earlier.startMinute)}${NBSP}–${NBSP}${earlier.endMinute === MINUTES_PER_DAY ? 'minuit' : clockWords(earlier.endMinute)}`,
        path: [j, 'startMinute'],
      });
    });
  });

/**
 * One date out of her week type (ADR 0148 § 3): that day, on her clock, these ranges replace her reply slots, a slot of
 * the day before that runs past midnight included; no range means no agent that day. Stored in
 * `agent_hour_exceptions`, one row per creator and date.
 */
export const AgentHourExceptionSchema = z.object({ date: LocalDateSchema, ranges: DayRangesSchema });
export type AgentHourException = z.infer<typeof AgentHourExceptionSchema>;

/** `PUT /v1/creators/:id/agent-hours/exceptions/:date`: the ranges of that date. */
export const SetAgentHourExceptionBodySchema = z.object({ ranges: DayRangesSchema });
export type SetAgentHourExceptionBody = z.infer<typeof SetAgentHourExceptionBodySchema>;

export const AgentHourExceptionParamsSchema = z.object({ id: CreatorIdSchema, date: LocalDateSchema });

/** `GET /v1/creators/:id/agent-hours/exceptions`: her exceptions from today on, on her clock, the earliest first. */
export const AgentHourExceptionsViewSchema = z.object({
  exceptions: z.array(
    AgentHourExceptionSchema.extend({
      /** Who wrote it last, and when: the screen's « modifié par ». */
      updatedBy: z.string().nullable(),
      updatedAt: z.iso.datetime(),
    }),
  ),
  /** Her clock (`creators.timezone`): the dates and minutes above are read on it. */
  timeZone: z.string().min(1),
  /** Her date today, on her clock: an exception before it no longer changes (ADR 0148 § 3). */
  today: LocalDateSchema,
});
export type AgentHourExceptionsView = z.infer<typeof AgentHourExceptionsViewSchema>;

/** Her date at `at`, on her clock, « 2026-11-20 », by `Intl` only. */
export function localDate(at: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The minutes of her clock where she can close: her slots' ends, and with exceptions their ranges' and midnight. */
function closingMinutes(hours: AgentHours, exceptions: DatedRanges): number[] {
  const slots = hours.reply.mode === 'slots' ? hours.reply.slots.filter((slot) => slot.enabled) : [];
  const minutes = slots.map((slot) => slot.endMinute);
  if (exceptions.length > 0) {
    minutes.push(
      0,
      // A range that ends at midnight ends at the next day's 0:00.
      ...exceptions.flatMap((exception) =>
        exception.ranges.map((range) => range.endMinute % MINUTES_PER_DAY),
      ),
    );
  }
  return [...new Set(minutes)];
}

/**
 * Her hours at `at` as the switch says them (ADR 0148 § 1): open or not, and when that changes, the closing when
 * open, the next opening when closed. `changesAt` is `null` when nothing changes in the next eight days (always open,
 * or a week closed by hand). The switches (Arrêt, pause, global) are read elsewhere: this is her hours alone.
 */
export const AgentHoursNowSchema = z.object({ open: z.boolean(), changesAt: z.iso.datetime().nullable() });
export type AgentHoursNow = z.infer<typeof AgentHoursNowSchema>;

export function agentHoursNow(
  hours: AgentHours,
  timeZone: string,
  at: Date,
  exceptions: DatedRanges = [],
): AgentHoursNow {
  if (!replyOpenAt(hours, timeZone, at, exceptions)) {
    const opening = nextReplyOpening(hours, timeZone, at, exceptions);
    return { open: false, changesAt: opening.getTime() === at.getTime() ? null : opening.toISOString() };
  }
  if (exceptions.length === 0 && hours.reply.mode === 'always') return { open: true, changesAt: null };
  let best: Date | undefined;
  for (const end of closingMinutes(hours, exceptions)) {
    let from = new Date(at.getTime() + MINUTE_MS);
    for (let i = 0; i < 8; i += 1) {
      const candidate = nextWallMinute(from, timeZone, end);
      if (best !== undefined && candidate >= best) break;
      if (!replyOpenAt(hours, timeZone, candidate, exceptions)) best = candidate;
      from = new Date(candidate.getTime() + MINUTE_MS);
    }
  }
  return { open: true, changesAt: best === undefined ? null : best.toISOString() };
}
