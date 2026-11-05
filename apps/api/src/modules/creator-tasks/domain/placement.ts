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

const QUARTER_MS = 15 * 60_000;

/**
 * The first room of `minutes` from `from` (VEI-01 d: a validated idea goes into one of her open dispos, ADR 0060 § 5),
 * by the rules of `placementOf`: wholly inside a dispo, over none of what is busy, touching ends leaving room. It starts
 * at the start of a dispo or where something busy ends, never before `from` rounded up to the quarter hour. Null when
 * no dispo has room: the suggestion then stays undated, in « Ma semaine ».
 */
export function firstPlacement(
  minutes: number,
  windows: readonly Interval[],
  busy: readonly Interval[],
  from: Date,
): Interval | null {
  if (minutes <= 0) return null;
  const earliest = Math.ceil(from.getTime() / QUARTER_MS) * QUARTER_MS;
  const starts = [
    ...windows.map((window) => window.startsAt.getTime()),
    ...busy.map((interval) => interval.endsAt.getTime()),
  ].map((start) => Math.max(start, earliest));
  for (const start of [...new Set(starts)].sort((a, b) => a - b)) {
    const wanted = { startsAt: new Date(start), endsAt: new Date(start + minutes * 60_000) };
    const placed = placementOf(wanted, windows, busy);
    if (placed !== null) return placed;
  }
  return null;
}
