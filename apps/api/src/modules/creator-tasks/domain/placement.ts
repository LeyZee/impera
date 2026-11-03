import type { Interval } from './availability';

/**
 * Where a dated suggestion may fall (ADR 0042 § 4): wholly inside one of her dispos, and over none of her timed
 * tasks. Anything else leaves it undated, in « Ma semaine », for her to place or decline; it is never moved for her.
 */
export function placementOf(
  wanted: Interval,
  windows: readonly Interval[],
  timedTasks: readonly Interval[],
): Interval | null {
  if (wanted.endsAt <= wanted.startsAt) return null;
  const inside = windows.some(
    (window) => window.startsAt <= wanted.startsAt && wanted.endsAt <= window.endsAt,
  );
  if (!inside) return null;
  // Touching ends do not overlap: a task until 18 h leaves 18 h free.
  const overlaps = timedTasks.some((task) => task.startsAt < wanted.endsAt && wanted.startsAt < task.endsAt);
  return overlaps ? null : wanted;
}
