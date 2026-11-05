import { EventIdSchema, newId, type EventType } from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';

import type { DueOriginal, RetentionStore } from '../../domain/ports';

const { contentDropFiles, contentDrops, domainEvents, mediaAssets } = schema;

/** A medium a drop kept: one of her files names it in the `kept` state (a duplicate only points at it). */
const keptByDrop = sql`exists (select 1 from ${contentDropFiles} k
  where k.media_asset_id = ${mediaAssets.id} and k.state = 'kept')`;

/** Every drop it came in by (kept or duplicate) is withdrawn: nothing she still holds points at it. */
const allWithdrawn = sql`not exists (select 1 from ${contentDropFiles} f
  join ${contentDrops} d on d.id = f.drop_id
  where f.media_asset_id = ${mediaAssets.id} and d.state <> 'withdrawn')`;

/** A notice for a medium, said once per date (`domain_events_content_media_unique`, migration 0113). */
async function sayOnce(
  tx: Transaction,
  type: Extract<EventType, 'content_media_expiring' | 'content_media_erase_failed'>,
  creatorId: string,
  payload: Record<string, string>,
  now: Date,
  correlationId: string,
): Promise<boolean> {
  const inserted = await tx
    .insert(domainEvents)
    .values({
      id: newId(EventIdSchema),
      creatorId,
      type,
      payload,
      actor: 'system',
      correlationId,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: domainEvents.id });
  return inserted.length > 0;
}

/** `content_drops.erase_originals`'s reads and writes, as the admin role: no policy lets anyone else move a state. */
export function createDrizzleRetentionStore(adminDb: Database): RetentionStore {
  return {
    abandonedFiles: (before) =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({ id: contentDropFiles.id })
          .from(contentDropFiles)
          .innerJoin(contentDrops, eq(contentDrops.id, contentDropFiles.dropId))
          .where(
            and(
              eq(contentDrops.state, 'uploading'),
              sql`${contentDrops.createdAt} < ${before}`,
              eq(contentDropFiles.state, 'awaiting'),
            ),
          );
        return rows.map((row) => row.id);
      }),

    announce: (now, until, correlationId) =>
      withAdmin(adminDb, async (tx) => {
        const coming = await tx
          .select({ id: mediaAssets.id, creatorId: mediaAssets.creatorId, expiresAt: mediaAssets.expiresAt })
          .from(mediaAssets)
          .where(
            and(
              sql`${mediaAssets.erasedAt} is null`,
              sql`${mediaAssets.expiresAt} > ${now} and ${mediaAssets.expiresAt} <= ${until}`,
              keptByDrop,
              sql`not (${allWithdrawn})`,
            ),
          );
        let said = 0;
        for (const medium of coming) {
          if (medium.expiresAt === null) continue;
          const erasedOn = medium.expiresAt.toISOString().slice(0, 10);
          if (
            await sayOnce(
              tx,
              'content_media_expiring',
              medium.creatorId,
              { mediaAssetId: medium.id, erasedOn },
              now,
              correlationId,
            )
          )
            said += 1;
        }
        return said;
      }),

    dueOriginals: (now) =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({
            mediaAssetId: mediaAssets.id,
            creatorId: mediaAssets.creatorId,
            storageKey: mediaAssets.storageKey,
            expiresAt: mediaAssets.expiresAt,
            withdrawn: sql<boolean>`${allWithdrawn}`,
          })
          .from(mediaAssets)
          .where(
            and(
              sql`${mediaAssets.erasedAt} is null`,
              keptByDrop,
              sql`(${mediaAssets.expiresAt} <= ${now} or ${allWithdrawn})`,
            ),
          );
        return rows.map(({ withdrawn, expiresAt, ...original }): DueOriginal => ({
          ...original,
          reason: withdrawn ? 'withdrawn' : 'due',
          // Every original a drop kept has its date (`keptUntil`); a medium without one is erased on the day.
          erasedOn: (expiresAt ?? now).toISOString().slice(0, 10),
        }));
      }),

    erased: (original, now, correlationId) =>
      withAdmin(adminDb, async (tx) => {
        const marked = await tx
          .update(mediaAssets)
          .set({ erasedAt: now })
          .where(
            and(
              eq(mediaAssets.id, original.mediaAssetId),
              sql`${mediaAssets.erasedAt} is null`,
              // Still due: given again meanwhile (a new date), it stays held.
              sql`(${mediaAssets.expiresAt} <= ${now} or ${allWithdrawn})`,
            ),
          )
          .returning({ id: mediaAssets.id });
        if (marked.length === 0) return;
        await tx.insert(domainEvents).values({
          id: newId(EventIdSchema),
          creatorId: original.creatorId,
          type: 'content_media_erased',
          payload: { mediaAssetId: original.mediaAssetId, reason: original.reason },
          actor: 'system',
          correlationId,
          createdAt: now,
        });
      }),

    eraseFailed: (original, now, correlationId) =>
      withAdmin(adminDb, async (tx) => {
        await sayOnce(
          tx,
          'content_media_erase_failed',
          original.creatorId,
          { mediaAssetId: original.mediaAssetId, erasedOn: original.erasedOn },
          now,
          correlationId,
        );
      }),
  };
}
