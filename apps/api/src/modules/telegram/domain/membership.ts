import type { TelegramMembership } from '@nirvana/contracts';

/**
 * REG-28: a group leaves the list only once the bot is out of it, gone (`left`) or banned (`kicked`). A group where the
 * bot still sits, even without the right to write, stays: giving it back that right is the way out.
 */
export function mayRemoveChat(membership: TelegramMembership): boolean {
  return membership !== 'member';
}
