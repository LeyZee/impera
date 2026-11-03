import { addDays, isoWeekday, wallClockToInstant } from '../../scheduling/pure';

/**
 * Her dispos (ADR 0042 § 4): the time she opens to the agency, every week on a weekday or once. A weekly dispo is
 * written in her wall-clock time and lives through the changes of time: 18 h – 22 h stays 18 h – 22 h in summer.
 */
export type Availability =
  | {
      readonly kind: 'weekly';
      /** 1 Monday … 7 Sunday. */
      readonly weekday: number;
      /** Minutes after her midnight. */
      readonly startMinute: number;
      /** Up to a day after `startMinute`: 22 h – 2 h ends at 26 × 60, the next day. */
      readonly endMinute: number;
    }
  | { readonly kind: 'once'; readonly startsAt: Date; readonly endsAt: Date };

export interface Interval {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Her dispos as instants between `fromDay` and `toDay` (both included, her days), sorted. A weekly dispo that starts
 * on `toDay` is kept whole, even past its midnight; a dispo once is kept when it meets those days.
 */
export function availabilityWindows(
  availabilities: readonly Availability[],
  fromDay: string,
  toDay: string,
  timeZone: string,
): Interval[] {
  const from = wallClockToInstant(fromDay, 0, timeZone);
  const to = wallClockToInstant(addDays(toDay, 1), 0, timeZone);
  const windows: Interval[] = [];
  for (const availability of availabilities) {
    if (availability.kind === 'once') {
      if (availability.endsAt > from && availability.startsAt < to) windows.push(availability);
      continue;
    }
    for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
      if (isoWeekday(day) !== availability.weekday) continue;
      const startsAt = wallClockToInstant(day, availability.startMinute, timeZone);
      const endsAt = wallClockToInstant(day, availability.endMinute, timeZone);
      // A wall-clock time the spring gap swallows on both ends leaves nothing open.
      if (endsAt > startsAt) windows.push({ startsAt, endsAt });
    }
  }
  return windows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
