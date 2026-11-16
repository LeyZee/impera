import type { CreatorId, PutSocialAccountsBody, SocialAccount } from '@impera/contracts';

/**
 * « Ses comptes » (ADR 0143 § C): her accounts elsewhere, in the owner's order. The owner and a manager read them, the
 * owner alone changes them, each change of « l'agent peut le donner » audited (§ 20). The agent reads them through
 * `forAgent`, in her tenant: a job never writes them.
 */
export interface SocialAccountStore {
  /** Hers, in order, read by the owner or an active manager (`userId`). */
  list(creatorId: CreatorId, userId: string): Promise<readonly SocialAccount[]>;
  /** Replaces the whole list as the owner (`userId`): an account keeps its id, one left out is removed. */
  replace(
    creatorId: CreatorId,
    body: PutSocialAccountsBody,
    userId: string,
  ): Promise<readonly SocialAccount[]>;
  /**
   * What the agent reads, in her tenant (ADR 0143 bounds 18, 19): the accounts it may give, in order, marked by the
   * owner; and every user name of hers, so that the guard blocks any it was not given at this turn.
   */
  forAgent(creatorId: CreatorId): Promise<SocialAccountsForAgent>;
}

interface SocialAccountsForAgent {
  readonly shareable: readonly SocialAccount[];
  readonly usernames: readonly string[];
}

/** What one replacement changed of « l'agent peut le donner », for the audit: ids and uses, never a user name. */
export function sharingChanges(
  before: readonly Pick<SocialAccount, 'id' | 'usage' | 'agentMayShare'>[],
  after: readonly Pick<SocialAccount, 'id' | 'usage' | 'agentMayShare'>[],
): { readonly id: string; readonly usage: string; readonly agentMayShare: boolean }[] {
  const was = new Map(before.map((account) => [account.id, account.agentMayShare]));
  const now = new Set(after.map((account) => account.id));
  return [
    ...after
      .filter((account) => (was.get(account.id) ?? false) !== account.agentMayShare)
      .map(({ id, usage, agentMayShare }) => ({ id, usage, agentMayShare })),
    // A shareable account removed stops being given: audited as turned off.
    ...before
      .filter((account) => account.agentMayShare && !now.has(account.id))
      .map(({ id, usage }) => ({ id, usage, agentMayShare: false })),
  ];
}
