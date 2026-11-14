import type { UserRole } from '@impera/contracts';

/**
 * Who reads the planning and the end-of-shift reports (ADR 0024, ADR 0026 § 1): the owner and the agency's accounts,
 * each with what their scope gives them (`withMember`), never a creator, whose own door is ADR 0042's. The routes ask
 * it of the session (`requireRole('owner', 'operator')`); the reads another door calls ask it here, so that the rule is
 * the same for both.
 */
export const readsTeamSchedule = (role: UserRole): boolean => role === 'owner' || role === 'operator';

/**
 * The creators a read is confined to: every creator the person reads, or those of a list. Ids that name no creator
 * are dropped, never an error: the caller's list may be older than the directory.
 */
export type CreatorBound = 'all' | readonly string[];

export function boundCreators<Id extends string>(bound: CreatorBound, existing: readonly Id[]): Id[] {
  if (bound === 'all') return [...existing];
  const asked = new Set(bound);
  return existing.filter((id) => asked.has(id));
}
