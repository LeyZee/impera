import {
  CreatorSettingsSchema,
  DropMediaKindSchema,
  JOB_MAX_ATTEMPTS,
  newId,
  ScriptDropSummaryIdSchema,
  ScriptSlotKeySchema,
  ShotMomentSchema,
} from '@impera/contracts';
import { and, eq, inArray, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';

import type { ScriptSummaryStore } from '../../domain/ports';

const { contentDropFiles, contentDrops, contentRequests, mediaAssets, scriptDropSummaries } = schema;

/**
 * `content_drops.summarize_script` for a script she sent (ADR 0083 § 6), keyed by the drop: one waiting job whatever
 * asked for it (her sending, each description); `runAt` puts it off (budget spent), `null` runs it now.
 */
export async function enqueueSummary(
  tx: Transaction,
  job: { readonly creatorId: string; readonly dropId: string; readonly correlationId: string },
  runAt: Date | null,
): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'content_drops.summarize_script',
      payload => ${JSON.stringify(job)}::jsonb,
      run_at => ${runAt === null ? null : runAt.toISOString()}::timestamptz,
      max_attempts => ${JOB_MAX_ATTEMPTS['content_drops.summarize_script']}::int,
      job_key => ${`content_drops.summarize_script:${job.dropId}`},
      job_key_mode => 'replace'
    )`,
  );
}

/** A sent script: neither being filled nor withdrawn. */
const sent = sql`${contentDrops.category} = 'script' and ${contentDrops.state} not in ('filling', 'withdrawn')`;

/** The synthesis job's reads and writes, as the owner role. */
export function createDrizzleScriptSummaryStore(adminDb: Database): ScriptSummaryStore {
  return {
    target: (dropId) =>
      withAdmin(adminDb, async (tx) => {
        const [drop] = await tx
          .select({
            creatorId: contentDrops.creatorId,
            settings: schema.creators.settings,
            versionId: contentRequests.structureVersionId,
            moment: contentRequests.moment,
          })
          .from(contentDrops)
          .innerJoin(schema.creators, eq(schema.creators.id, contentDrops.creatorId))
          .innerJoin(contentRequests, eq(contentRequests.id, contentDrops.requestId))
          .where(and(eq(contentDrops.id, dropId), sent))
          .limit(1);
        if (drop?.versionId == null) return null;
        const files = await tx
          .select({
            slotKey: contentDropFiles.slotKey,
            mediaAssetId: contentDropFiles.mediaAssetId,
            kind: contentDropFiles.kind,
            durationMs: mediaAssets.durationMs,
          })
          .from(contentDropFiles)
          .leftJoin(mediaAssets, eq(mediaAssets.id, contentDropFiles.mediaAssetId))
          .where(
            and(
              eq(contentDropFiles.dropId, dropId),
              sql`${contentDropFiles.slotKey} is not null`,
              sql`${contentDropFiles.replacedAt} is null`,
              sql`${contentDropFiles.state} <> 'refused'`,
            ),
          )
          .orderBy(contentDropFiles.position);
        return {
          creatorId: drop.creatorId,
          describes: CreatorSettingsSchema.parse(drop.settings).describeDrops,
          versionId: drop.versionId,
          moment: ShotMomentSchema.nullable().parse(drop.moment),
          files: files.map((file) => ({
            slotKey: ScriptSlotKeySchema.parse(file.slotKey),
            mediaAssetId: file.mediaAssetId,
            kind: DropMediaKindSchema.parse(file.kind),
            durationS: file.durationMs === null ? null : file.durationMs / 1000,
          })),
        };
      }),
    summarized: (dropId, mediaHash, promptHash) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({ id: scriptDropSummaries.id })
          .from(scriptDropSummaries)
          .where(
            and(
              eq(scriptDropSummaries.dropId, dropId),
              eq(scriptDropSummaries.mediaHash, mediaHash),
              eq(scriptDropSummaries.promptHash, promptHash),
            ),
          )
          .limit(1);
        return row !== undefined;
      }),
    save: (creatorId, dropId, summary) =>
      withAdmin(adminDb, async (tx) => {
        await tx
          .insert(scriptDropSummaries)
          .values({
            id: newId(ScriptDropSummaryIdSchema),
            creatorId,
            dropId,
            mediaHash: summary.mediaHash,
            content: summary.content,
            reviewReasons: [...summary.reviewReasons],
            model: summary.model,
            promptHash: summary.promptHash,
          })
          .onConflictDoNothing();
      }),
    later: (creatorId, dropId, correlationId, runAt) =>
      withAdmin(adminDb, (tx) => enqueueSummary(tx, { creatorId, dropId, correlationId }, runAt)),
    enqueueFor: (mediaAssetId, correlationId) =>
      withAdmin(adminDb, async (tx) => {
        const drops = await tx
          .selectDistinct({ creatorId: contentDrops.creatorId, dropId: contentDrops.id })
          .from(contentDropFiles)
          .innerJoin(contentDrops, eq(contentDrops.id, contentDropFiles.dropId))
          .where(
            and(
              eq(contentDropFiles.mediaAssetId, mediaAssetId),
              inArray(contentDropFiles.state, ['kept', 'duplicate']),
              sql`${contentDropFiles.slotKey} is not null`,
              sql`${contentDropFiles.replacedAt} is null`,
              sent,
            ),
          );
        for (const drop of drops) await enqueueSummary(tx, { ...drop, correlationId }, null);
        return drops.length;
      }),
  };
}
