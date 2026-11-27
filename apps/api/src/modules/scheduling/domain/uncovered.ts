import type { CreatorId, PlatformAccountId, SchedulingSettings } from '@impera/contracts';

import {
  agentReplySpans,
  slotsToFill,
  type CreatorAgent,
  type GridAccount,
  type GridShift,
} from './calendar';

/**
 * « Compte sans personne » (ADR 0094 § 1, lot a), pure. How far back each run looks for a créneau that began: the job
 * runs every five minutes, so a run that failed or a worker restarted loses nothing, and a créneau seen twice is
 * published once (unique index on the account and the créneau's start).
 */
export const UNCOVERED_LOOKBACK_MS = 15 * 60_000;

/** A fan wrote to the account within this long before the créneau began: an account nobody writes to is left quiet. */
export const UNCOVERED_FAN_RECENT_MS = 24 * 60 * 60_000;

/** A créneau that began on an account with nobody answering. */
export interface UncoveredSlot {
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

const covers = (span: { readonly from: Date; readonly to: Date }, at: Date): boolean =>
  span.from.getTime() <= at.getTime() && at.getTime() < span.to.getTime();

/**
 * The créneaux that began in the last `UNCOVERED_LOOKBACK_MS` (start after `now − lookback`, at or before `now`) and
 * that nobody answered at their start: the planning counts them to fill (`slotsToFill`, the calendar's rule, so that a
 * créneau the agent holds alone in Automatique is never one), no shift on the account holds their first minute, and
 * the agent does not answer it in Automatique. `shifts` are those the members hold (`heldUntil`): a shift of a member
 * away or no longer on her list covers nothing. Whether a fan wrote lately is read apart, by the job.
 */
export function uncoveredSlotStarts(input: {
  readonly settings: Pick<SchedulingSettings, 'timeZone' | 'versions'>;
  readonly accounts: readonly GridAccount[];
  readonly shifts: readonly GridShift[];
  readonly agents: readonly CreatorAgent[];
  readonly now: Date;
}): UncoveredSlot[] {
  const since = new Date(input.now.getTime() - UNCOVERED_LOOKBACK_MS);
  const { toFill } = slotsToFill({
    settings: input.settings,
    accounts: input.accounts,
    shifts: input.shifts,
    agents: input.agents,
    window: { from: since, to: input.now },
    now: since,
  });
  const agentOf = new Map(input.agents.map((agent) => [agent.creatorId, agent]));
  return toFill
    .filter((slot) => slot.startsAt > since && slot.startsAt <= input.now)
    .filter(
      (slot) =>
        !input.shifts.some(
          (shift) =>
            shift.platformAccountId === slot.platformAccountId &&
            covers({ from: shift.startsAt, to: shift.endsAt }, slot.startsAt),
        ),
    )
    .filter((slot) => {
      const agent = agentOf.get(slot.creatorId);
      if (agent?.mode !== 'auto') return true;
      const first = { from: slot.startsAt, to: new Date(slot.startsAt.getTime() + 60_000) };
      return !agentReplySpans(agent, first).some((span) => covers(span, slot.startsAt));
    })
    .map((slot) => ({
      creatorId: slot.creatorId,
      platformAccountId: slot.platformAccountId,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
    }));
}
