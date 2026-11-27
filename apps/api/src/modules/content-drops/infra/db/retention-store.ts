import { AuditEntryIdSchema, EventIdSchema, newId, type EventType } from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, withTenantJob, type Database, type Transaction } from '@impera/db';

import type { DueOriginal, DueThumbnail, RetentionStore } from '../../domain/ports';

const { auditLog, contentDropFiles, contentDrops, creators, domainEvents, mediaAssets } = schema;

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

/**
 * `content_drops.erase_originals`'s reads and writes (SEC-16). What is due is found across the creators, as the admin
 * role, and only read; each thing is then moved in its own creator, under the app role (`withTenantJob`, `drop_media`):
 * a medium named with another creator's id is not found there, and nothing of hers is erased nor said.
 */
export function createDrizzleRetentionStore(adminDb: Database, db: Database): RetentionStore {
  const inCreator = <T>(creatorId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenantJob(db, creatorId, 'drop_media', fn);
  /** Hers, said outright besides the policy. */
  const herMedium = (creatorId: string, mediaAssetId: string) =>
    and(eq(mediaAssets.id, mediaAssetId), eq(mediaAssets.creatorId, creatorId));
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
              // A drop sending since before the limit; in a script being filled, or a medium replaced in a drop received
              // (trou 7 du 21/11), a file chosen before it (SC-02 lot b).
              sql`((${contentDrops.state} = 'uploading' and ${contentDrops.createdAt} < ${before})
                or (${contentDrops.state} in ('filling', 'received') and ${contentDropFiles.createdAt} < ${before}))`,
            ),
          );
        return rows.map((row) => row.id);
      }),

    announce: async (now, until, correlationId) => {
      const coming = await withAdmin(adminDb, (tx) =>
        tx
          .select({ id: mediaAssets.id, creatorId: mediaAssets.creatorId, expiresAt: mediaAssets.expiresAt })
          .from(mediaAssets)
          .where(
            and(
              sql`${mediaAssets.erasedAt} is null`,
              sql`${mediaAssets.expiresAt} > ${now} and ${mediaAssets.expiresAt} <= ${until}`,
              keptByDrop,
              sql`not (${allWithdrawn})`,
            ),
          ),
      );
      const byCreator = new Map<string, typeof coming>();
      for (const one of coming) byCreator.set(one.creatorId, [...(byCreator.get(one.creatorId) ?? []), one]);
      let said = 0;
      for (const [creatorId, hers] of byCreator)
        said += await inCreator(creatorId, async (tx) => {
          let count = 0;
          for (const one of hers) {
            if (one.expiresAt === null) continue;
            const erasedOn = one.expiresAt.toISOString().slice(0, 10);
            if (
              await sayOnce(
                tx,
                'content_media_expiring',
                creatorId,
                { mediaAssetId: one.id, erasedOn },
                now,
                correlationId,
              )
            )
              count += 1;
          }
          return count;
        });
      return said;
    },

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
      inCreator(original.creatorId, async (tx) => {
        // The receipt's settle locks this row too: a medium given again waits for the erasure, or keeps it away.
        await tx
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(herMedium(original.creatorId, original.mediaAssetId))
          .for('update');
        // Checked again once locked, in a statement of its own that sees what committed while it waited: given again
        // meanwhile (a new date, a drop not withdrawn), it stays held.
        const [due] = await tx
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(
            and(
              herMedium(original.creatorId, original.mediaAssetId),
              sql`${mediaAssets.erasedAt} is null`,
              sql`(${mediaAssets.expiresAt} <= ${now} or ${allWithdrawn})`,
            ),
          );
        if (due === undefined) return false;
        // The storage's call under the lock: an hourly job, and the client's time limit bounds it.
        await remove(original.storageKey);
        await tx
          .update(mediaAssets)
          .set({ erasedAt: now })
          .where(herMedium(original.creatorId, original.mediaAssetId));
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

    dueThumbnails: (archivedBefore) =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({
            mediaAssetId: mediaAssets.id,
            creatorId: mediaAssets.creatorId,
            thumbnailKey: mediaAssets.thumbnailKey,
          })
          .from(mediaAssets)
          .innerJoin(creators, eq(creators.id, mediaAssets.creatorId))
          .where(
            and(
              sql`${mediaAssets.thumbnailKey} is not null`,
              sql`${creators.archivedAt} < ${archivedBefore}`,
            ),
          );
        return rows.flatMap(({ thumbnailKey, ...medium }): DueThumbnail[] =>
          thumbnailKey === null ? [] : [{ ...medium, thumbnailKey }],
        );
      }),

    eraseThumbnail: (thumbnail, archivedBefore, remove) =>
      inCreator(thumbnail.creatorId, async (tx) => {
        await tx
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(herMedium(thumbnail.creatorId, thumbnail.mediaAssetId))
          .for('update');
        // Checked again once locked: reopened meanwhile, she keeps it; emptied meanwhile, nothing to do.
        const [due] = await tx
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .innerJoin(creators, eq(creators.id, mediaAssets.creatorId))
          .where(
            and(
              herMedium(thumbnail.creatorId, thumbnail.mediaAssetId),
              eq(mediaAssets.thumbnailKey, thumbnail.thumbnailKey),
              sql`${creators.archivedAt} < ${archivedBefore}`,
            ),
          );
        if (due === undefined) return false;
        await remove(thumbnail.thumbnailKey);
        // `thumbnailed_at` stays: the picture is never made again (ADR 0089 § 1).
        await tx
          .update(mediaAssets)
          .set({ thumbnailKey: null })
          .where(herMedium(thumbnail.creatorId, thumbnail.mediaAssetId));
        return true;
      }),

    thumbnailsErased: (creatorId, count) =>
      inCreator(creatorId, async (tx) => {
        await tx.insert(auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: null,
          action: 'media.thumbnails_erased',
          entity: 'creator',
          entityId: creatorId,
          details: { count },
        });
      }),

    eraseFailed: (original, now, correlationId) =>
      inCreator(original.creatorId, async (tx) => {
        // Said only of a medium of hers: one named with another creator's id is not found here.
        const [held] = await tx
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(herMedium(original.creatorId, original.mediaAssetId));
        if (held === undefined) return;
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
