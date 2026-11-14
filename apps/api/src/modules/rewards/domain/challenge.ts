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

const CHALLENGE_WEEKS = 8;
const DAY_MS = 86_400_000;

/** A shift as the challenge reads it: when it began and when it ended, or will. */
export interface ChallengeShift {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** A line of the member's own statements that has an instant, in the currency that brought them the most. */
export interface TimedNet {
  readonly at: Date;
  readonly netMinor: number;
}

export interface ShiftChallenge {
  readonly targetMinor: number;
  readonly netMinor: number;
  readonly met: boolean;
}

/** The weekday and the minute of the day a shift starts at in the agency's zone: what makes two shifts comparable. */
function slotOf(startsAt: Date, agencyZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: agencyZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(startsAt);
}

const netOf = (shift: ChallengeShift, nets: readonly TimedNet[]): number =>
  nets
    .filter((net) => net.at >= shift.startsAt && net.at < shift.endsAt)
    .reduce((sum, net) => sum + net.netMinor, 0);

/**
 * The challenge of `shift`: the median of the member's own net on the shifts ended before it began, in the eight
 * weeks before, that started on the same weekday at the same time. `null` when there is none (§ 14).
 */
export function shiftChallenge(input: {
  readonly shift: ChallengeShift;
  readonly past: readonly ChallengeShift[];
  readonly nets: readonly TimedNet[];
  readonly agencyZone: string;
}): ShiftChallenge | null {
  const { shift, past, nets, agencyZone } = input;
  const slot = slotOf(shift.startsAt, agencyZone);
  const since = shift.startsAt.getTime() - CHALLENGE_WEEKS * 7 * DAY_MS;
  const comparable = past.filter(
    (one) =>
      one.endsAt <= shift.startsAt &&
      one.startsAt.getTime() >= since &&
      slotOf(one.startsAt, agencyZone) === slot,
  );
  const targetMinor = challengeTarget(comparable.map((one) => netOf(one, nets)));
  if (targetMinor === null) return null;
  const netMinor = netOf(shift, nets);
  return { targetMinor, netMinor, met: challengeMet(netMinor, targetMinor) };
}

/** How long after its end a shift's challenge is still shown. */
const SHOWN_AFTER_HOURS = 12;

/** The shift whose challenge is shown at `now`: the one under way, else the last one ended less than 12 h ago. */
export function shownShift(shifts: readonly ChallengeShift[], now: Date): ChallengeShift | null {
  const begun = shifts.filter((shift) => shift.startsAt <= now).toSorted((a, b) => +a.startsAt - +b.startsAt);
  const last = begun.at(-1);
  if (last === undefined) return null;
  return now.getTime() < last.endsAt.getTime() + SHOWN_AFTER_HOURS * 3_600_000 ? last : null;
}
