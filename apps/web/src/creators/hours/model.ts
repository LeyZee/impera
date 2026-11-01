import {
  AGENT_SLOTS_MAX,
  AgentHoursSchema,
  DEFAULT_AGENT_HOURS,
  nextFollowUpAllowed,
  SUGGESTED_REPLY_SLOTS,
  type AgentHours,
  type AgentSlot,
  type MinuteRange,
} from '@nirvana/contracts';

import { cityOf, clockOf, MINUTES_PER_DAY } from '@/scheduling/time';

/*
 * Créatrices › Heures (P3-14) in words and shapes: her slots on a week of her clock, the sentences the planning uses
 * (« 9 h – 1 h », « jusqu'au lendemain »), the issues of the contract placed on the line they belong to. Pure
 * functions: the section lays them out.
 */

export const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
export const DAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;

const NBSP = '\u00a0';

/** « 23 h – 5 h », with the spaces of the planning: a range never splits across two lines. */
export const rangeOf = (range: MinuteRange): string =>
  `${clockOf(range.startMinute)}${NBSP}–${NBSP}${clockOf(range.endMinute)}`;

/**
 * What a slot covers: « toute la journée », « 9 h – 1 h, jusqu'au lendemain », « 9 h – 18 h ». A slot that ends at
 * 0 h closes with her day: nothing of it falls on the next one.
 */
export function slotWords(slot: Pick<AgentSlot, 'startMinute' | 'endMinute'>): string {
  const note = slotNote(slot);
  if (slot.startMinute === slot.endMinute || note === null) return note ?? rangeOf(slot);
  return `${rangeOf(slot)}, ${note}`;
}

/**
 * What a line of the planner adds to its two hours (CREA-21): only what the fields do not say, « jusqu'au
 * lendemain » or « toute la journée »; nothing for an ordinary slot.
 */
export function slotNote(slot: Pick<AgentSlot, 'startMinute' | 'endMinute'>): string | null {
  if (slot.startMinute === slot.endMinute) return 'toute la journée';
  return slot.endMinute !== 0 && slot.endMinute < slot.startMinute ? 'jusqu’au lendemain' : null;
}

/**
 * The header that says whose clock the page reads: the planning reads at the agency's hour, these hours at hers.
 * Her first name only, like the reader of Suivi.
 */
export const clockHeader = (name: string, timeZone: string): string =>
  `À l’heure de ${name.trim().split(/\s+/u)[0] ?? name} (${cityOf(timeZone)})`;

/** A slot drawn on one day of the week: an overnight slot is two bars, the second one « continued » the next day. */
export interface Bar {
  /** 1 Monday … 7 Sunday. */
  readonly day: number;
  /** Minutes from midnight; `to` may be 1440. */
  readonly from: number;
  readonly to: number;
  readonly enabled: boolean;
  /** The part of an overnight slot that falls after midnight. */
  readonly continued: boolean;
  /** Its index in the setting, to name it. */
  readonly index: number;
}

/** Every slot on the week of her clock; a slot past Sunday night continues on Monday. */
export function barsOf(slots: readonly AgentSlot[]): Bar[] {
  return slots.flatMap((slot, index) => {
    const base = { enabled: slot.enabled, index };
    if (slot.startMinute === slot.endMinute)
      return [{ ...base, day: slot.day, from: 0, to: MINUTES_PER_DAY, continued: false }];
    if (slot.endMinute > slot.startMinute)
      return [{ ...base, day: slot.day, from: slot.startMinute, to: slot.endMinute, continued: false }];
    const next = (slot.day % 7) + 1;
    return [
      { ...base, day: slot.day, from: slot.startMinute, to: MINUTES_PER_DAY, continued: false },
      ...(slot.endMinute === 0 ? [] : [{ ...base, day: next, from: 0, to: slot.endMinute, continued: true }]),
    ];
  });
}

/** The slots in the order of the week (day, then start), each with its index in the setting. */
export const orderedSlots = (
  slots: readonly AgentSlot[],
): { readonly slot: AgentSlot; readonly index: number }[] =>
  slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => a.slot.day - b.slot.day || a.slot.startMinute - b.slot.startMinute || a.index - b.index);

/**
 * Her setting with its slots in the order of the week. Done when it arrives and when it is saved, never while she
 * types: a line stays where it is under the cursor (CREA-22). The order means nothing to the agent.
 */
export const sortedHours = (hours: AgentHours): AgentHours =>
  hours.reply.mode === 'slots'
    ? { ...hours, reply: { mode: 'slots', slots: orderedSlots(hours.reply.slots).map(({ slot }) => slot) } }
    : hours;

/** The lines of each day of the week, Monday first, each slot with its index in the setting, in the setting's order. */
export const slotsByDay = (
  slots: readonly AgentSlot[],
): { readonly day: number; readonly lines: { readonly slot: AgentSlot; readonly index: number }[] }[] =>
  DAY_NAMES.map((_, i) => ({
    day: i + 1,
    lines: slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.day === i + 1),
  }));

const WEEK_MINUTES = 7 * MINUTES_PER_DAY;

/** Where a slot sits in the week, in minutes from Monday 0 h, cut in two when it runs past Sunday night. */
function weekSpans(slot: AgentSlot): { from: number; to: number }[] {
  const from = (slot.day - 1) * MINUTES_PER_DAY + slot.startMinute;
  const length = (slot.endMinute - slot.startMinute + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY;
  const to = from + length;
  return to <= WEEK_MINUTES
    ? [{ from, to }]
    : [
        { from, to: WEEK_MINUTES },
        { from: 0, to: to - WEEK_MINUTES },
      ];
}

/** A new slot is never longer than the one suggested, 9 h – 1 h. */
const NEW_SLOT_MAX = 16 * 60;
/** Nor shorter than an hour. */
const NEW_SLOT_MIN = 60;

/**
 * The slot « Ajouter » of one day adds (CREA-21): 9 h – 1 h when that day has none and it is free, otherwise the
 * first free stretch that starts on that day (an hour at least, 16 h at most). Null when that day has no free hour.
 */
export const newSlotOn = (slots: readonly AgentSlot[], day: number): AgentSlot | null =>
  freeSlot(slots, slots.some((slot) => slot.day === day) ? null : day, day);

/** `suggestOn`: the day to try 9 h – 1 h on first; `startOn`: the one day the stretch must start on, or any. */
function freeSlot(
  slots: readonly AgentSlot[],
  suggestOn: number | null,
  startOn: number | null,
): AgentSlot | null {
  const spans = slots.flatMap(weekSpans).sort((a, b) => a.from - b.from);
  const free = (from: number, to: number): boolean =>
    [-WEEK_MINUTES, 0, WEEK_MINUTES].every((shift) =>
      spans.every((span) => !(span.from < to + shift && from + shift < span.to)),
    );
  if (suggestOn !== null) {
    const suggested: AgentSlot = { day: suggestOn, startMinute: 9 * 60, endMinute: 60, enabled: true };
    if (weekSpans(suggested).every((span) => free(span.from, span.to))) return suggested;
  }
  const dayStart = startOn === null ? 0 : (startOn - 1) * MINUTES_PER_DAY;
  const starts = [dayStart, ...spans.map((span) => span.to % WEEK_MINUTES)].filter(
    (start) => startOn === null || (start >= dayStart && start < dayStart + MINUTES_PER_DAY),
  );
  // Each stretch starts where a slot ends; the week is a circle, Sunday night runs into Monday.
  for (const start of starts.sort((a, b) => a - b)) {
    if (!free(start, start + NEW_SLOT_MIN)) continue;
    let length = NEW_SLOT_MIN;
    while (length < NEW_SLOT_MAX && free(start, start + length + 15)) length += 15;
    const startMinute = start % MINUTES_PER_DAY;
    return {
      day: Math.floor(start / MINUTES_PER_DAY) + 1,
      startMinute,
      endMinute: (startMinute + length) % MINUTES_PER_DAY,
      enabled: true,
    };
  }
  return null;
}

export const canAddSlot = (slots: readonly AgentSlot[]): boolean => slots.length < AGENT_SLOTS_MAX;

/** Said once under the days when the week holds all the slots it may. */
export const WEEK_FULL = `${String(AGENT_SLOTS_MAX)} créneaux au plus dans la semaine : retires-en un d’abord.`;

/**
 * Why « Ajouter » adds nothing that day, said in the day's line rather than in a tooltip; null when it adds one, and
 * null too when the week is full, which `WEEK_FULL` says once for all the days.
 */
export function noSlotWhy(slots: readonly AgentSlot[], day: number): string | null {
  if (!canAddSlot(slots)) return null;
  return newSlotOn(slots, day) === null
    ? 'Plus une heure de libre ce jour-là : raccourcis un créneau d’abord.'
    : null;
}

/** The slots offered when the owner switches to slots: the ones she had, or 9 h – 1 h every day. */
export const slotsToOffer = (kept: readonly AgentSlot[] | null): AgentSlot[] =>
  kept !== null && kept.length > 0 ? [...kept] : [...SUGGESTED_REPLY_SLOTS];

/** The contract's issues, by path (`reply.slots.3.startMinute`): the first message of each. */
export function issuesOf(hours: AgentHours): ReadonlyMap<string, string> {
  const parsed = AgentHoursSchema.safeParse(hours);
  const issues = new Map<string, string>();
  if (parsed.success) return issues;
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String).join('.');
    if (!issues.has(path)) issues.set(path, issue.message);
  }
  return issues;
}

/** The issue of one slot line: its overlap, or a field of it. */
export function slotIssue(issues: ReadonlyMap<string, string>, index: number): string | null {
  const prefix = `reply.slots.${String(index)}`;
  for (const [path, message] of issues) if (path === prefix || path.startsWith(`${prefix}.`)) return message;
  return null;
}

/** The issue of a range (`followUpQuiet`, `night`). */
export function rangeIssue(
  issues: ReadonlyMap<string, string>,
  key: 'followUpQuiet' | 'night',
): string | null {
  for (const [path, message] of issues) if (path === key || path.startsWith(`${key}.`)) return message;
  return null;
}

/** Two settings say the same thing (the screen compares a draft with what is stored). */
export const sameHours = (a: AgentHours, b: AgentHours): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The draft is the defaults: saving it stores none (`null`), so that she follows them as they are. */
export const isDefaultHours = (hours: AgentHours): boolean => sameHours(hours, DEFAULT_AGENT_HOURS);

/**
 * No follow-up can ever go out: no minute of her week is both in a slot and out of her quiet hours (slots from
 * 23 h to 1 h with quiet hours from 23 h to 9 h). A warning, not an error: she may want it. Said of a setting the
 * contract takes only: with every slot off, the contract's own error is the one to read.
 */
export const noFollowUpEver = (hours: AgentHours, timeZone: string, now: Date): boolean =>
  hours.reply.mode === 'slots' &&
  AgentHoursSchema.safeParse(hours).success &&
  nextFollowUpAllowed(hours, timeZone, now) === null;
