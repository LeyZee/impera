import { DropMediaKindSchema, JOB_MAX_ATTEMPTS } from '@impera/contracts';
import { eq, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';
import { z } from 'zod';

import type { ThumbnailQueue } from '../../domain/ports';

const { mediaAssets } = schema;

/** At most this many each hour: the rest comes the next hour. */
const PER_RUN = 200;

const CountSchema = z.object({ n: z.coerce.number().int() });

/**
 * `content_drops.make_thumbnail` for a photo or a video of her library (SC-04 lot c4), keyed by the medium; `runAt` puts
 * it off (disk short), `null` runs it now.
 */
export async function enqueueThumbnail(
  tx: Transaction,
  job: { readonly creatorId: string; readonly mediaAssetId: string; readonly correlationId: string },
  runAt: Date | null,
): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'content_drops.make_thumbnail',
      payload => ${JSON.stringify(job)}::jsonb,
      run_at => ${runAt === null ? null : runAt.toISOString()}::timestamptz,
      max_attempts => ${JOB_MAX_ATTEMPTS['content_drops.make_thumbnail']}::int,
      job_key => ${`content_drops.make_thumbnail:${job.mediaAssetId}`},
      job_key_mode => 'replace'
    )`,
  );
}

/** The picture job's reads and writes, as the owner role. */
export function createDrizzleThumbnailQueue(adminDb: Database): ThumbnailQueue {
  return {
    target: (mediaAssetId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({
            creatorId: mediaAssets.creatorId,
            kind: mediaAssets.kind,
            bytes: mediaAssets.bytes,
            storageKey: mediaAssets.storageKey,
            sha256: mediaAssets.sha256,
            erasedAt: mediaAssets.erasedAt,
            thumbnailedAt: mediaAssets.thumbnailedAt,
          })
          .from(mediaAssets)
          .where(eq(mediaAssets.id, mediaAssetId));
        if (row === undefined) return null;
        return {
          creatorId: row.creatorId,
          kind: DropMediaKindSchema.parse(row.kind),
          bytes: row.bytes,
          storageKey: row.storageKey,
          sha256: row.sha256,
          erased: row.erasedAt !== null,
          tried: row.thumbnailedAt !== null,
        };
      }),

    settle: (mediaAssetId, thumbnailKey, now) =>
      withAdmin(adminDb, async (tx) => {
        await tx
          .update(mediaAssets)
          .set({ thumbnailKey, thumbnailedAt: now })
          .where(sql`${mediaAssets.id} = ${mediaAssetId} and ${mediaAssets.thumbnailedAt} is null`);
      }),

    later: (creatorId, mediaAssetId, correlationId, runAt) =>
      withAdmin(adminDb, (tx) => enqueueThumbnail(tx, { creatorId, mediaAssetId, correlationId }, runAt)),

    backlog: (correlationId) =>
      withAdmin(adminDb, async (tx) => {
        const result = await tx.execute(sql`
          select count(public.enqueue_job(
            task => 'content_drops.make_thumbnail',
            payload => jsonb_build_object('creatorId', q.creator_id, 'mediaAssetId', q.id, 'correlationId', ${correlationId}::text),
            max_attempts => ${JOB_MAX_ATTEMPTS['content_drops.make_thumbnail']}::int,
            job_key => 'content_drops.make_thumbnail:' || q.id,
            job_key_mode => 'preserve_run_at'
          ))::int as n
          from (
            select m.creator_id, m.id
              from media_assets m
             where m.kind <> 'audio' and m.erased_at is null and m.thumbnailed_at is null
               and exists (
                 select 1 from content_drop_files f join content_drops d on d.id = f.drop_id
                  where f.media_asset_id = m.id and f.state in ('kept', 'duplicate') and f.replaced_at is null
                    and d.state <> 'withdrawn')
             order by m.created_at, m.id
             limit ${PER_RUN}
          ) q`);
        return CountSchema.parse(result.rows[0]).n;
      }),
  };
}
