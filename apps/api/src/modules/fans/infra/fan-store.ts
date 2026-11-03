import { CreatorIdSchema, FanIdSchema, PlatformAccountIdSchema } from '@impera/contracts';
import { and, eq, schema, sql, withTenant, type Database } from '@impera/db';

import type { Fan, FanStore } from '../domain/fan';

type FanRow = typeof schema.fans.$inferSelect;

function toFan(row: FanRow): Fan {
  return {
    id: FanIdSchema.parse(row.id),
    creatorId: CreatorIdSchema.parse(row.creatorId),
    platformAccountId: PlatformAccountIdSchema.parse(row.platformAccountId),
    platformFanId: row.platformFanId,
    displayName: row.displayName,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
  };
}

export function createDrizzleFanStore(db: Database): FanStore {
  return {
    upsert: (sighting, id) =>
      withTenant(db, sighting.creatorId, async (tx) => {
        const [row] = await tx
          .insert(schema.fans)
          .values({
            id,
            creatorId: sighting.creatorId,
            platformAccountId: sighting.platformAccountId,
            platformFanId: sighting.platformFanId,
            displayName: sighting.displayName,
            firstSeenAt: sighting.seenAt,
            lastSeenAt: sighting.seenAt,
          })
          .onConflictDoUpdate({
            target: [schema.fans.platformAccountId, schema.fans.platformFanId],
            set: {
              displayName: sighting.displayName,
              lastSeenAt: sql`greatest(${schema.fans.lastSeenAt}, ${sighting.seenAt.toISOString()}::timestamptz)`,
            },
          })
          .returning();
        if (row === undefined) throw new Error('Fan upsert returned no row');
        return toFan(row);
      }),
    get: (creatorId, id) =>
      withTenant(db, creatorId, async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.fans)
          .where(and(eq(schema.fans.id, id), eq(schema.fans.creatorId, creatorId)));
        return row === undefined ? null : toFan(row);
      }),
  };
}
