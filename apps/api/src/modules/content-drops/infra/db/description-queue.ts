import {
  CreatorSettingsSchema,
  DropCategorySchema,
  DropMediaKindSchema,
  JOB_MAX_ATTEMPTS,
} from '@impera/contracts';
import { and, eq, inArray, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';

import type { DescriptionQueue } from '../../domain/ports';

const { contentDropFiles, contentDrops, contentRequests, mediaAssets } = schema;

/**
 * `content_drops.describe_file` for a medium of her library (ADR 0083 § 1), keyed by the medium: once, whichever of
 * its files came first; `runAt` puts it off (budget spent, disk short), `null` runs it now.
 */
export async function enqueueDescription(
  tx: Transaction,
  job: { readonly creatorId: string; readonly mediaAssetId: string; readonly correlationId: string },
  runAt: Date | null,
): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'content_drops.describe_file',
      payload => ${JSON.stringify(job)}::jsonb,
      run_at => ${runAt === null ? null : runAt.toISOString()}::timestamptz,
      max_attempts => ${JOB_MAX_ATTEMPTS['content_drops.describe_file']}::int,
      job_key => ${`content_drops.describe_file:${job.mediaAssetId}`},
      job_key_mode => 'replace'
    )`,
  );
}

/** The describing job's reads, as the owner role: a medium, her switch, and the first live file of a drop holding it. */
export function createDrizzleDescriptionQueue(adminDb: Database): DescriptionQueue {
  return {
    target: (mediaAssetId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({
            creatorId: mediaAssets.creatorId,
            kind: mediaAssets.kind,
            mime: mediaAssets.mime,
            bytes: mediaAssets.bytes,
            storageKey: mediaAssets.storageKey,
            erasedAt: mediaAssets.erasedAt,
            settings: schema.creators.settings,
            category: contentDrops.category,
            slotKey: contentDropFiles.slotKey,
            versionId: contentRequests.structureVersionId,
          })
          .from(mediaAssets)
          .innerJoin(schema.creators, eq(schema.creators.id, mediaAssets.creatorId))
          .innerJoin(contentDropFiles, eq(contentDropFiles.mediaAssetId, mediaAssets.id))
          .innerJoin(contentDrops, eq(contentDrops.id, contentDropFiles.dropId))
          .leftJoin(contentRequests, eq(contentRequests.id, contentDrops.requestId))
          .where(
            and(
              eq(mediaAssets.id, mediaAssetId),
              inArray(contentDropFiles.state, ['kept', 'duplicate']),
              sql`${contentDropFiles.replacedAt} is null`,
              sql`${contentDrops.state} <> 'withdrawn'`,
            ),
          )
          .orderBy(contentDropFiles.createdAt, contentDropFiles.id)
          .limit(1);
        if (row === undefined) return null;
        return {
          creatorId: row.creatorId,
          kind: DropMediaKindSchema.parse(row.kind),
          mime: row.mime,
          bytes: row.bytes,
          storageKey: row.storageKey,
          erased: row.erasedAt !== null,
          describes: CreatorSettingsSchema.parse(row.settings).describeDrops,
          category: DropCategorySchema.parse(row.category),
          script:
            row.slotKey === null || row.versionId === null
              ? null
              : { slotKey: row.slotKey, versionId: row.versionId },
        };
      }),
    later: (creatorId, mediaAssetId, correlationId, runAt) =>
      withAdmin(adminDb, (tx) => enqueueDescription(tx, { creatorId, mediaAssetId, correlationId }, runAt)),
    failed: (mediaAssetId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .update(mediaAssets)
          .set({ descriptionFailures: sql`${mediaAssets.descriptionFailures} + 1` })
          .where(eq(mediaAssets.id, mediaAssetId))
          .returning({ failures: mediaAssets.descriptionFailures });
        return row?.failures ?? 0;
      }),
  };
}
