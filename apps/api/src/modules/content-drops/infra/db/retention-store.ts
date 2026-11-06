import { EventIdSchema, newId, type EventType } from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';

import type { DueOriginal, RetentionStore } from '../../domain/ports';

const { contentDropFiles, contentDrops, domainEvents, mediaAssets } = schema;

/** A medium a drop kept: one of her files names it in the `kept` state (a duplicate only points at it). */
const keptByDrop = sql`exists (select 1 from ${contentDropFiles} k
  where k.media_asset_id = ${mediaAssets.id} and k.state = 'kept')`;

/**
 * Every file it came in by (kept or duplicate) is out: its drop withdrawn, or the file replaced in its slot before she
 * sent her script (SC-02 lot b). Nothing she still holds points at it.
 */
const allWithdrawn = sql`not exists (select 1 from ${contentDropFiles} f
  join ${contentDrops} d on d.id = f.drop_id
  where f.media_asset_id = ${mediaAssets.id} and d.state <> 'withdrawn' and f.replaced_at is null)`;

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
              eq(contentDropFiles.state, 'awaiting'),
              // A drop sending since before the limit; in a script being filled, a file chosen before it (SC-02 lot b).
              sql`((${contentDrops.state} = 'uploading' and ${contentDrops.createdAt} < ${before})
                or (${contentDrops.state} = 'filling' and ${contentDropFiles.createdAt} < ${before}))`,
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

    erase: (original, now, correlationId, remove) =>
      withAdmin(adminDb, async (tx) => {
        // The receipt's settle locks this row too: a medium given again waits for the erasure, or keeps it away.
        await tx
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(eq(mediaAssets.id, original.mediaAssetId))
          .for('update');
        // Checked again once locked, in a statement of its own that sees what committed while it waited: given again
        // meanwhile (a new date, a drop not withdrawn), it stays held.
        const [due] = await tx
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(
            and(
              eq(mediaAssets.id, original.mediaAssetId),
              sql`${mediaAssets.erasedAt} is null`,
              sql`(${mediaAssets.expiresAt} <= ${now} or ${allWithdrawn})`,
            ),
          );
        if (due === undefined) return false;
        // The storage's call under the lock: an hourly job, and the client's time limit bounds it.
        await remove(original.storageKey);
        await tx.update(mediaAssets).set({ erasedAt: now }).where(eq(mediaAssets.id, original.mediaAssetId));
        await tx.insert(domainEvents).values({
          id: newId(EventIdSchema),
          creatorId: original.creatorId,
          type: 'content_media_erased',
          payload: { mediaAssetId: original.mediaAssetId, reason: original.reason },
          actor: 'system',
          correlationId,
          createdAt: now,
        });
        return true;
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
