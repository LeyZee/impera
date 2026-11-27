import type { CreatorId } from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, type Database } from '@impera/db';

import type { MessagePhones } from '../../domain/ports';

/**
 * Who hears of her message and of its answer, by the service role (as the alerts router): the owners in the agency's
 * zone, the active managers who work on her in theirs; her accounts (role `creator`, linked to her alone) in hers.
 */
export function createMessagePhones(adminDb: Database, agencyTimeZone: () => Promise<string>): MessagePhones {
  return {
    agency: async (creatorId: CreatorId) => {
      const [creator, owners, managers, zone] = await Promise.all([
        withAdmin(adminDb, (tx) =>
          tx
            .select({ name: schema.creators.displayName })
            .from(schema.creators)
            .where(eq(schema.creators.id, creatorId)),
        ),
        withAdmin(adminDb, (tx) =>
          tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.role, 'owner')),
        ),
        withAdmin(adminDb, (tx) =>
          tx
            .select({ userId: schema.teamMembers.userId, timeZone: schema.teamMembers.timeZone })
            .from(schema.teamMembers)
            .innerJoin(schema.user, eq(schema.user.id, schema.teamMembers.userId))
            .where(
              and(
                eq(schema.teamMembers.teamRole, 'manager'),
                eq(schema.teamMembers.status, 'active'),
                sql`${creatorId}::uuid = any(${schema.user.creatorIds})`,
              ),
            ),
        ),
        agencyTimeZone(),
      ]);
      return {
        creatorName: creator[0]?.name ?? 'Une créatrice',
        phones: [
          ...owners.map((owner) => ({ userId: owner.id, timeZone: zone })),
          ...managers.map((manager) => ({ userId: manager.userId, timeZone: manager.timeZone })),
        ],
      };
    },
    hers: (creatorId: CreatorId) =>
      withAdmin(adminDb, async (tx) => {
        const [creator] = await tx
          .select({ timeZone: schema.creators.timezone })
          .from(schema.creators)
          .where(eq(schema.creators.id, creatorId));
        const accounts = await tx
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(
            and(
              eq(schema.user.role, 'creator'),
              sql`${schema.user.creatorIds} = array[${creatorId}]::uuid[]`,
            ),
          )
          .orderBy(schema.user.id);
        return accounts.map((one) => ({ userId: one.id, timeZone: creator?.timeZone ?? 'Europe/Paris' }));
      }),
  };
}
