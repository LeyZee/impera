import { replyOpenAt, type AgentHours, type DatedRanges } from '@impera/contracts';

/**
 * How long before her hours close she starts to say goodbye (ADR 0156 § 7, ADR 0158 § A 7): a step or a new game
 * started then would be cut off, so she takes her leave instead, as a girl whose evening ends.
 */
const GOODBYE_BEFORE_CLOSING_MS = 20 * 60_000;

/** Her hours are open now and will be closed in a few minutes: her answer is her goodbye for the day. */
export function herDayEndsSoon(
  hours: AgentHours,
  timeZone: string,
  now: Date,
  exceptions: DatedRanges = [],
): boolean {
  return (
    replyOpenAt(hours, timeZone, now, exceptions) &&
    !replyOpenAt(hours, timeZone, new Date(now.getTime() + GOODBYE_BEFORE_CLOSING_MS), exceptions)
  );
}
