/*
 * The streak (ADR 0104 § 13): how many of a member's planned shifts in a row had their report handed in on time.
 * A rest day is no shift at all; a shift swapped away or cancelled by the agency is `excused` and neither counts
 * nor breaks; a shift whose report is not due yet is `pending`. A report late, or never made once due, resets it.
 * The best streak stays.
 */

export type StreakReport = 'on_time' | 'late' | 'missing' | 'excused' | 'pending';

export interface StreakShift {
  /** When the shift ends: the order the streak is counted in. */
  readonly endsAt: Date;
  readonly report: StreakReport;
}

export interface Streak {
  readonly current: number;
  readonly best: number;
}

export function streakOf(shifts: readonly StreakShift[]): Streak {
  let current = 0;
  let best = 0;
  for (const shift of shifts.toSorted((a, b) => a.endsAt.getTime() - b.endsAt.getTime())) {
    if (shift.report === 'excused' || shift.report === 'pending') continue;
    current = shift.report === 'on_time' ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return { current, best };
}
