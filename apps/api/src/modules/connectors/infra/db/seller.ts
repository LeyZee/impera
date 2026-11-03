import { TeamMemberIdSchema, type SaleSeller } from '@impera/contracts';

/** The owner's link of a platform chatter, as `sales_feed_chatters` keeps it. */
export interface ChatterLinkRow {
  readonly kind: string;
  readonly memberId: string | null;
}

/**
 * Who sold a line, by its chatter and the owner's link of it (ADR 0050 § 5), as pay reads its author: a member, the
 * agent, a chatter nobody linked yet, or no chatter at all.
 */
export function sellerOf(platformChatterId: string | null, link: ChatterLinkRow | undefined): SaleSeller {
  if (platformChatterId === null) return { kind: 'none' };
  if (link?.kind === 'member' && link.memberId !== null) {
    return { kind: 'member', memberId: TeamMemberIdSchema.parse(link.memberId) };
  }
  if (link?.kind === 'agent') return { kind: 'agent' };
  return { kind: 'unlinked' };
}
