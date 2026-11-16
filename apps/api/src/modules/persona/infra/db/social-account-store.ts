import {
  AuditEntryIdSchema,
  newId,
  SocialAccountIdSchema,
  SocialAccountPlatformSchema,
  SocialAccountUsageSchema,
  type SocialAccount,
} from '@impera/contracts';
import { eq, schema, withTenant, withTenantMember, type Database, type Transaction } from '@impera/db';

import { SocialAccountsForbidden } from '../../domain/errors';
import { sharingChanges, type SocialAccountStore } from '../../domain/social-accounts';

const t = schema.socialAccounts;

interface Row {
  id: string;
  platform: string;
  username: string;
  usage: string;
  agentMayShare: boolean;
  updatedAt: Date;
}

const columns = {
  id: t.id,
  platform: t.platform,
  username: t.username,
  usage: t.usage,
  agentMayShare: t.agentMayShare,
  updatedAt: t.updatedAt,
};

const toAccount = (row: Row): SocialAccount => ({
  id: SocialAccountIdSchema.parse(row.id),
  platform: SocialAccountPlatformSchema.parse(row.platform),
  username: row.username,
  usage: SocialAccountUsageSchema.parse(row.usage),
  agentMayShare: row.agentMayShare,
  updatedAt: row.updatedAt.toISOString(),
});

const inOrder = async (tx: Transaction, creatorId: string): Promise<SocialAccount[]> =>
  (await tx.select(columns).from(t).where(eq(t.creatorId, creatorId)).orderBy(t.position)).map(toAccount);

/** « Ses comptes » in Postgres (migration 0230): her tenant reads, the owner's scope alone writes (RLS). */
export function createDrizzleSocialAccountStore(db: Database): SocialAccountStore {
  return {
    list: (creatorId, userId) =>
      withTenantMember(db, creatorId, userId, (tx, scope) => {
        // Her team only: a chatter, on his own scope, never reads them (the policy reads nothing for him either).
        if (scope !== 'owner' && scope !== 'agency') throw new SocialAccountsForbidden();
        return inOrder(tx, creatorId);
      }),

    replace: (creatorId, body, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (scope !== 'owner') throw new SocialAccountsForbidden();
        const before = await inOrder(tx, creatorId);
        // The whole list, in its order: cleared then written, in one transaction, under the owner's policies.
        await tx.delete(t).where(eq(t.creatorId, creatorId));
        if (body.accounts.length > 0)
          await tx.insert(t).values(
            body.accounts.map((account, position) => ({
              id: account.id,
              creatorId,
              platform: account.platform,
              username: account.username,
              usage: account.usage,
              agentMayShare: account.agentMayShare,
              position,
              updatedBy: userId,
            })),
          );
        const after = await inOrder(tx, creatorId);
        // Each change of « l'agent peut le donner », with who made it; never a user name (ADR 0143 § 20).
        for (const change of sharingChanges(before, after))
          await tx.insert(schema.auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId,
            action: change.agentMayShare ? 'social_account.share_on' : 'social_account.share_off',
            entity: 'social_account',
            entityId: change.id,
            details: { creatorId, usage: change.usage },
          });
        return after;
      }),

    forAgent: (creatorId) =>
      withTenant(db, creatorId, async (tx) => {
        const all = (
          await tx.select(columns).from(t).where(eq(t.creatorId, creatorId)).orderBy(t.position)
        ).map(toAccount);
        return {
          shareable: all.filter((account) => account.agentMayShare),
          usernames: all.map((account) => account.username),
        };
      }),
  };
}
