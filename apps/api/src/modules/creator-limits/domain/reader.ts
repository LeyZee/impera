import type { CreatorId, CurrentUser } from '@impera/contracts';

/**
 * Who reads her absences and what she no longer does, as who reads her chatter sheet (ADR 0153): the owner, whoever has
 * her on his list, and a chatter on shift for her. A chatter routed to her but off shift reads them at his next shift.
 */
export function readsLimits(
  user: Pick<CurrentUser, 'role' | 'creatorIds' | 'shiftCreatorIds'>,
  creatorId: CreatorId,
): boolean {
  return (
    user.role === 'owner' || user.creatorIds.includes(creatorId) || user.shiftCreatorIds.includes(creatorId)
  );
}
