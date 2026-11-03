import { SlotVersionInputSchema, type SlotVersionInput } from '@impera/contracts';

import { SlotVersionDateInvalid, SlotVersionInvalid } from './errors';
import { addDays, calendarDayIn, isoWeekday, wallClockToInstant } from './time';

/**
 * A new version of the créneaux (ADR 0049 § 1 and § 2), pure: the list held again as the contract holds it (24 h with
 * no hole nor overlap, 1 h to 12 h each, on the hour, 2 to 24; each place on a créneau of the list, once per account),
 * then the instant it takes effect, in the grid's zone:
 * - a Monday (`startsOn`): at its first créneau's start that day, which must be ahead;
 * - « tout de suite » (`null`): at the next start of one of its créneaux after `now`, so that the créneau under way
 *   keeps its start and ends where the new one begins (`slotWindowsOf`). Nothing is ever back-dated.
 */
export function effectiveAtOf(input: SlotVersionInput, now: Date, timeZone: string): Date {
  const held = SlotVersionInputSchema.safeParse(input);
  if (!held.success) throw new SlotVersionInvalid(held.error.issues[0]?.message ?? 'Créneaux invalides');
  const { slots, startsOn } = held.data;
  if (startsOn !== null) {
    const first = slots[0];
    if (isoWeekday(startsOn) !== 1 || first === undefined) throw new SlotVersionDateInvalid();
    const at = wallClockToInstant(startsOn, first.startMinute, timeZone);
    if (at.getTime() <= now.getTime()) throw new SlotVersionDateInvalid();
    return at;
  }
  // Every créneau starts once a day at its minute: the next start is today's or tomorrow's (yesterday's for a zone
  // whose day has not turned yet).
  const today = calendarDayIn(now, timeZone);
  const starts = [-1, 0, 1, 2].flatMap((shift) =>
    slots.map((slot) => wallClockToInstant(addDays(today, shift), slot.startMinute, timeZone).getTime()),
  );
  const next = Math.min(...starts.filter((start) => start > now.getTime()));
  return new Date(next);
}
