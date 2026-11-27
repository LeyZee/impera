import {
  DESCRIPTION_TRIES,
  JOB_MAX_ATTEMPTS,
  JOB_PAYLOADS,
  MEDIA_VOCABULARY_VERSION,
  MediaAssetIdSchema,
  MediaDescriptionIdSchema,
  accountQueueNameFor,
  newId,
  vaultDescribeJobKey,
} from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';
import { z } from 'zod';

import type { VaultDescribeStore, VaultRef } from '../application/describe-vault';

const { creators, mediaAssets, mediaDescriptions, mediaPlatformRefs, platformAccounts } = schema;

/** What a `platform` description keeps (ADR 0099 § 4): the platform's text alone, never a field of the vision's. */
const PlatformDescriptionSchema = z.object({ platformText: z.string().min(1) });
/** The version a `platform` row is written with: there is no prompt behind the platform's text. */
const PLATFORM_PROMPT = 'platform';

const RefRowSchema = z.object({
  id: z.string(),
  platform_media_id: z.string(),
  kind: z.enum(['image', 'video']),
  folder_ref: z.string().nullable(),
  folder_name: z.string().nullable(),
  platform_created_at: z.string(),
  folder_position: z.coerce.number().int(),
  platform_description: z.string().nullable(),
  platform: z.string(),
});
const ScriptRowSchema = z.object({ id: z.string(), active: z.boolean(), media: z.string() });
const CountSchema = z.object({ n: z.coerce.number().int() });

/** The platform's text beside its media (author `platform`, never validated), once per text. */
async function keepPlatformText(
  tx: Transaction,
  creatorId: string,
  mediaAssetId: string,
  ref: VaultRef,
): Promise<void> {
  const text = ref.platformDescription?.trim() ?? '';
  if (text === '') return;
  const content = PlatformDescriptionSchema.parse({ platformText: text });
  const [already] = await tx
    .select({ id: mediaDescriptions.id })
    .from(mediaDescriptions)
    .where(
      and(
        eq(mediaDescriptions.mediaAssetId, mediaAssetId),
        eq(mediaDescriptions.author, 'platform'),
        sql`${mediaDescriptions.content} = ${JSON.stringify(content)}::jsonb`,
      ),
    )
    .limit(1);
  if (already !== undefined) return;
  await tx.insert(mediaDescriptions).values({
    id: newId(MediaDescriptionIdSchema),
    creatorId,
    mediaAssetId,
    vocabularyVersion: MEDIA_VOCABULARY_VERSION,
    content,
    model: ref.platform,
    promptHash: PLATFORM_PROMPT,
    author: 'platform',
  });
}

async function linkRef(tx: Transaction, ref: VaultRef, mediaAssetId: string): Promise<void> {
  await tx
    .update(mediaPlatformRefs)
    .set({ mediaAssetId })
    .where(and(eq(mediaPlatformRefs.id, ref.refId), sql`${mediaPlatformRefs.mediaAssetId} is null`));
}

interface Job {
  readonly creatorId: string;
  readonly platformAccountId: string;
  readonly correlationId: string;
}

/** `media.describe_vault` on the account's queue, under its key (one waiting run per account). */
async function enqueue(
  executor: Database | Transaction,
  job: Job,
  runAt: Date | null,
  mode: 'replace' | 'preserve_run_at',
): Promise<void> {
  const payload: unknown = JOB_PAYLOADS['media.describe_vault'].parse(job);
  await executor.execute(sql`select public.enqueue_job(
    task => 'media.describe_vault',
    payload => ${JSON.stringify(payload)}::jsonb,
    queue_name => ${accountQueueNameFor(job.platformAccountId)},
    run_at => ${runAt?.toISOString() ?? null}::timestamptz,
    max_attempts => ${JOB_MAX_ATTEMPTS['media.describe_vault']}::int,
    job_key => ${vaultDescribeJobKey(job.platformAccountId)},
    job_key_mode => ${mode}
  )`);
}

/**
 * `media.describe_vault`'s reads and writes, as the owner role (ADR 0087): the job crosses no tenant, it is keyed by an
 * account. It writes `media_assets` and `media_descriptions`, and of `media_platform_refs` the link and the tries only.
 */
export function createDrizzleVaultDescribeStore(adminDb: Database): VaultDescribeStore {
  return {
    account: (platformAccountId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({ creatorId: platformAccounts.creatorId })
          .from(platformAccounts)
          .innerJoin(creators, eq(creators.id, platformAccounts.creatorId))
          .where(and(eq(platformAccounts.id, platformAccountId), sql`${creators.archivedAt} is null`))
          .limit(1);
        if (row === undefined) return null;
        return { creatorId: row.creatorId };
      }),

    waiting: (creatorId, platformAccountId) =>
      withAdmin(adminDb, async (tx) => {
        const refs = await tx.execute(sql`
          select id, platform, platform_media_id, kind, folder_ref, folder_name,
                 to_char(platform_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as platform_created_at,
                 folder_position, platform_description
            from ${mediaPlatformRefs} r
           where creator_id = ${creatorId} and platform_account_id = ${platformAccountId}
             and media_asset_id is null and removed_at is null and kind in ('image', 'video')
             and description_failures < ${DESCRIPTION_TRIES}
             -- Only what the owner asked and what is in the CRM (ADR 0145 § 5): nothing is described of itself.
             and exists (select 1 from ${schema.vaultDescribeRequests} q
                          where q.platform_account_id = r.platform_account_id
                            and q.platform_media_id = r.platform_media_id)
             and ${schema.vaultImported({ account: sql`r.platform_account_id`, media: sql`r.platform_media_id`, folder: sql`r.folder_ref` })}`);
        // Every imported script of the account, its media in its own order: steps, previews before what is sold.
        const scripts = await tx.execute(sql`
          select s.id, s.active, m.platform_media_ref as media
            from ${schema.platformScripts} s
            join ${schema.platformScriptStepMedia} m on m.platform_script_id = s.id
           where s.creator_id = ${creatorId} and s.platform_account_id = ${platformAccountId}
           order by s.id, m.position, (m.role = 'preview') desc, m.rank`);
        const byScript = new Map<string, { scriptId: string; active: boolean; platformMediaIds: string[] }>();
        for (const row of z.array(ScriptRowSchema).parse(scripts.rows)) {
          const script = byScript.get(row.id) ?? {
            scriptId: row.id,
            active: row.active,
            platformMediaIds: [],
          };
          script.platformMediaIds.push(row.media);
          byScript.set(row.id, script);
        }
        return {
          refs: z
            .array(RefRowSchema)
            .parse(refs.rows)
            .map((row) => ({
              refId: row.id,
              platformMediaId: row.platform_media_id,
              kind: row.kind,
              folderRef: row.folder_ref,
              folderName: row.folder_name,
              platformCreatedAt: row.platform_created_at,
              folderPosition: row.folder_position,
              platformDescription: row.platform_description,
              platform: row.platform,
            })),
          scripts: [...byScript.values()],
        };
      }),

    assetOf: (creatorId, sha256) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({ id: mediaAssets.id, origin: mediaAssets.origin })
          .from(mediaAssets)
          .where(and(eq(mediaAssets.creatorId, creatorId), eq(mediaAssets.sha256, sha256)))
          .limit(1);
        return row === undefined ? null : { id: row.id, fromFan: row.origin === 'fan' };
      }),

    link: (creatorId, ref, mediaAssetId) =>
      withAdmin(adminDb, async (tx) => {
        await keepPlatformText(tx, creatorId, mediaAssetId, ref);
        await linkRef(tx, ref, mediaAssetId);
      }),

    keep: (creatorId, ref, asset, described) =>
      withAdmin(adminDb, async (tx) => {
        const [made] = await tx
          .insert(mediaAssets)
          .values({
            id: newId(MediaAssetIdSchema),
            creatorId,
            kind: asset.kind,
            origin: 'vault',
            // ADR 0113 § 1: the original never touched the storage, the row is born erased.
            storageKey: '',
            mime: asset.mime,
            bytes: asset.bytes,
            durationMs: asset.durationMs,
            sha256: asset.sha256,
            erasedAt: asset.at,
            thumbnailKey: asset.thumbnailKey,
            thumbnailedAt: asset.at,
          })
          .onConflictDoNothing({ target: [mediaAssets.creatorId, mediaAssets.sha256] })
          .returning({ id: mediaAssets.id });
        if (made === undefined) {
          // Written meanwhile under the same fingerprint: that one is hers, linked without a second description.
          const [known] = await tx
            .select({ id: mediaAssets.id, origin: mediaAssets.origin })
            .from(mediaAssets)
            .where(and(eq(mediaAssets.creatorId, creatorId), eq(mediaAssets.sha256, asset.sha256)))
            .limit(1);
          if (known === undefined) throw new Error('media_assets: a fingerprint in conflict and not found');
          // A media a fan sent is never linked to her vault: it would become proposable.
          if (known.origin === 'fan') return 'fan';
          await keepPlatformText(tx, creatorId, known.id, ref);
          await linkRef(tx, ref, known.id);
          return 'kept';
        }
        // The platform's text first: the vision's row, written after, is the latest of the media (`createdAt`, `id`).
        await keepPlatformText(tx, creatorId, made.id, ref);
        await tx
          .insert(mediaDescriptions)
          .values({
            id: newId(MediaDescriptionIdSchema),
            creatorId,
            mediaAssetId: made.id,
            vocabularyVersion: described.description.vocabularyVersion,
            content: described.description,
            model: described.model,
            promptHash: described.promptHash,
            author: 'sense',
            reviewReasons: [...described.reviewReasons],
          })
          .onConflictDoNothing();
        await linkRef(tx, ref, made.id);
        return 'kept';
      }),

    failed: (refId, count) =>
      withAdmin(adminDb, async (tx) => {
        const result = await tx.execute(sql`
          update ${mediaPlatformRefs}
             set description_failures = least(description_failures + ${count}, ${DESCRIPTION_TRIES})
           where id = ${refId}
          returning description_failures as n`);
        const [row] = z.array(CountSchema).parse(result.rows);
        return row?.n ?? 0;
      }),

    later: (job, runAt) => withAdmin(adminDb, (tx) => enqueue(tx, job, runAt, 'replace')),
  };
}

/** `media.describe_vault` queued behind a vault sync (ADR 0113 § 5): a run already waiting keeps its time. */
export function enqueueVaultDescribe(adminDb: Database, job: Job): Promise<void> {
  return enqueue(adminDb, job, null, 'preserve_run_at');
}

/**
 * `media.describe_vault` queued in the owner's transaction that asked descriptions (ADR 0145 § 5): a run already
 * waiting keeps its time, one put off by a spent budget is not brought forward.
 */
export function enqueueVaultDescribeIn(tx: Transaction, job: Job): Promise<void> {
  return enqueue(tx, job, null, 'preserve_run_at');
}
