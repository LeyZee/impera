import { LEAVE_QUERY_MAX_DAYS, type LeaveRequestStatus, type TeamScope } from '@nirvana/contracts';

import {
  LeaveDateInvalid,
  LeaveDecided,
  LeaveNotWithdrawable,
  LeaveRangeInvalid,
  LeaveOwnDecision,
  PlanningForbidden,
} from './errors';
import { addDays, wallClockToInstant } from './time';

/** Leave rules (ADR 0031, contract `scheduling.ts`), pure. */

/**
 * The instants of a leave: from midnight of `firstDay` to midnight after `lastDay`, in the member's zone when they
 * ask. Fixed then, so that a later change of zone never moves it.
 */
export function leaveInstants(
  firstDay: string,
  lastDay: string,
  timeZone: string,
): { readonly startsAt: Date; readonly endsAt: Date } {
  return {
    startsAt: wallClockToInstant(firstDay, 0, timeZone),
    endsAt: wallClockToInstant(addDays(lastDay, 1), 0, timeZone),
  };
}

/** A read of the leaves: `to` after `from`, `LEAVE_QUERY_MAX_DAYS` at most. */
export function assertLeaveRange(from: Date, to: Date): void {
  const span = to.getTime() - from.getTime();
  if (span <= 0 || span > LEAVE_QUERY_MAX_DAYS * 86_400_000) throw new LeaveRangeInvalid();
}

/** A leave starts today or later, in the member's zone. */
export function assertLeaveStart(firstDay: string, today: string): void {
  if (firstDay < today) throw new LeaveDateInvalid();
}

export interface LeaveSpan {
  readonly status: LeaveRequestStatus;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly cancelledAt: Date | null;
}

/**
 * What a leave covers: an approved one, from its start to its end; a cancelled one, up to its cancellation (nothing
 * when cancelled before it started); any other, nothing. The store's `leaveCovering` reads leaves through it.
 */
export function leaveCover(leave: LeaveSpan): { readonly startsAt: Date; readonly endsAt: Date } | null {
  if (leave.status === 'approved') return { startsAt: leave.startsAt, endsAt: leave.endsAt };
  if (leave.status !== 'cancelled' || leave.cancelledAt === null) return null;
  const endsAt = leave.cancelledAt.getTime() < leave.endsAt.getTime() ? leave.cancelledAt : leave.endsAt;
  return endsAt.getTime() > leave.startsAt.getTime() ? { startsAt: leave.startsAt, endsAt } : null;
}

/** Only a pending request is decided, by the owner or an active manager, a manager never on their own leave. */
export function assertDecides(
  scope: TeamScope,
  leave: { readonly status: LeaveRequestStatus; readonly own: boolean },
): void {
  if (scope !== 'owner' && scope !== 'agency') throw new PlanningForbidden();
  if (leave.own && scope === 'agency') throw new LeaveOwnDecision();
  if (leave.status !== 'pending') throw new LeaveDecided();
}

/**
 * What a `DELETE` does: the member withdraws their own pending request; the owner or an active manager cancels an
 * approved leave that has not ended. A pending request of someone else is refused, not withdrawn; a member's own
 * request already answered is `leave_decided_conflict`.
 */
export function leaveEnding(
  scope: TeamScope,
  leave: { readonly status: LeaveRequestStatus; readonly own: boolean; readonly endsAt: Date },
  now: Date,
): 'withdraw' | 'cancel' {
  const plans = scope === 'owner' || scope === 'agency';
  if (leave.status === 'pending') {
    if (leave.own) return 'withdraw';
    throw plans ? new LeaveNotWithdrawable() : new PlanningForbidden();
  }
  // Their own request already answered: that is what the member is told, not a lack of rights.
  if (!plans) throw leave.own ? new LeaveDecided() : new PlanningForbidden();
  if (leave.status === 'approved' && leave.endsAt.getTime() > now.getTime()) return 'cancel';
  throw new LeaveDecided();
}
