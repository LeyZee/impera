/*
 * The shift's challenge (ADR 0104 § 14): one a shift, worked out by the code from the member's own history, the
 * median of their net on the comparable shifts (same weekday, same slot) of the last eight weeks. Under four
 * comparable shifts there is none. Met or not, it never reaches pay (§ 17).
 */

/** The fewest comparable shifts a challenge is drawn from. */
const CHALLENGE_MIN_SHIFTS = 4;

/** The net to beat, in minor units, or `null` when the history is too thin or sold nothing. */
export function challengeTarget(comparableNetsMinor: readonly number[]): number | null {
  if (comparableNetsMinor.length < CHALLENGE_MIN_SHIFTS) return null;
  const sorted = comparableNetsMinor.toSorted((a, b) => a - b);
  const middle = sorted.length / 2;
  const median =
    sorted.length % 2 === 1
      ? (sorted[Math.floor(middle)] ?? 0)
      : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
  return median > 0 ? median : null;
}

/** A challenge is met when the shift's net reaches its target. */
export const challengeMet = (netMinor: number, targetMinor: number): boolean => netMinor >= targetMinor;
