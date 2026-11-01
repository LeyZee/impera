import type { TeamMemberStatus } from '@nirvana/contracts';

/** A team member's status other than `active`: away, he reads no conversation and holds none (EQ-13). */
export type AwayStatus = Exclude<TeamMemberStatus, 'active'>;

const AWAY_WORDS = {
  on_leave: 'en congé',
  sick: 'malade',
  travelling: 'en déplacement',
  suspended: 'suspendu',
  left: 'parti',
} as const satisfies Record<AwayStatus, string>;

/**
 * Why a conversation was handed back without a human asking (EQ-13, Charles's « oui » of 01/11): the member who held it
 * is no longer `active`. The journal keeps it as the release's reason; the next member or the agent reads why.
 */
export function awayReleaseReason(status: AwayStatus): string {
  return `Rendue automatiquement : le membre qui la tenait est ${AWAY_WORDS[status]}.`;
}
