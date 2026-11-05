import type { CreatorId } from '@impera/contracts';
import { eq, schema, withAdmin, type Database } from '@impera/db';

import type { AvatarRecords } from '../../domain/avatar';

/** `creators.avatar_key`, across creators: the job writes it for the creator it imported, the route reads it. */
export function createAvatarRecords(adminDb: Database): AvatarRecords {
  return {
    async set(creatorId: CreatorId, key: string) {
      const updated = await withAdmin(adminDb, (tx) =>
        tx
          .update(schema.creators)
          .set({ avatarKey: key })
          .where(eq(schema.creators.id, creatorId))
          .returning({ id: schema.creators.id }),
      );
      return updated.length > 0;
    },

    async keyOf(creatorId: CreatorId) {
      const [row] = await withAdmin(adminDb, (tx) =>
        tx
          .select({ avatarKey: schema.creators.avatarKey })
          .from(schema.creators)
          .where(eq(schema.creators.id, creatorId)),
      );
      return row?.avatarKey ?? null;
    },
  };
}
