import { schema, sql, withAdmin, type Database } from '@nirvana/db';

import type { FactPurge } from '../domain/fan';

/** Owner role: the purge runs for every creator at once, outside any tenant. */
export function createDrizzleFactPurge(adminDb: Database): FactPurge {
  return {
    dropFactsOfFansLastSeenBefore: async (cutoff) => {
      // A fan's whole history goes at once: `superseded_by` only points within one fan, so no row is left dangling.
      const removed = await withAdmin(adminDb, (tx) =>
        tx
          .delete(schema.fanFacts)
          .where(
            sql`${schema.fanFacts.fanId} in (select ${schema.fans.id} from ${schema.fans}
              where ${schema.fans.lastSeenAt} < ${cutoff.toISOString()}::timestamptz)`,
          )
          .returning({ id: schema.fanFacts.id }),
      );
      return removed.length;
    },
  };
}
