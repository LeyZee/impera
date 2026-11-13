import {
  AuditEntryIdSchema,
  CreatorSettingsSchema,
  DESCRIPTION_TRIES,
  JOB_MAX_ATTEMPTS,
  newId,
} from '@impera/contracts';
import { eq, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';
import { z } from 'zod';

import type { DescribeSwitch, DescriptionBacklog } from '../../domain/ports';

/** At most this many each hour per kind: the rest comes the next hour, the day's budget spends itself anyway. */
const MEDIA_PER_RUN = 500;
const SCRIPTS_PER_RUN = 200;

const CountSchema = z.object({ n: z.coerce.number().int() });

/** Her switch on, read in the base; one creator, or every one. */
const switchedOn = (creatorId: string | null) =>
  sql`(c.settings->>'describeDrops')::boolean is true and c.archived_at is null
    and (${creatorId}::uuid is null or c.id = ${creatorId}::uuid)`;

/**
 * Each medium of a live drop with no description of now: none for a drop, or only the vision's of an older prompt,
 * and none a human wrote or validated (ADR 0083 § 2, ADR 0030 § 3), nor one the vision failed on at each of its tries
 * (left to the agency, recette créatrice 2). Enqueued under the medium's key, keeping the time of a job waiting.
 */
async function enqueueMedia(
  tx: Transaction,
  creatorId: string | null,
  promptHash: string,
  correlationId: string,
): Promise<number> {
  const result = await tx.execute(sql`
    select count(public.enqueue_job(
      task => 'content_drops.describe_file',
      payload => jsonb_build_object('creatorId', q.creator_id, 'mediaAssetId', q.id, 'correlationId', ${correlationId}::text),
      max_attempts => ${JOB_MAX_ATTEMPTS['content_drops.describe_file']}::int,
      job_key => 'content_drops.describe_file:' || q.id,
      job_key_mode => 'preserve_run_at'
    ))::int as n
    from (
      select m.creator_id, m.id
        from media_assets m
        join creators c on c.id = m.creator_id
       where ${switchedOn(creatorId)}
         and m.kind <> 'audio' and m.erased_at is null
         and m.description_failures < ${DESCRIPTION_TRIES}
         and exists (
           select 1 from content_drop_files f join content_drops d on d.id = f.drop_id
            where f.media_asset_id = m.id and f.state in ('kept', 'duplicate') and f.replaced_at is null
              and d.state <> 'withdrawn')
         and not exists (
           select 1 from media_descriptions md
            where md.media_asset_id = m.id and md.content ? 'detailed'
              and (md.author = 'human' or md.validated_at is not null or md.prompt_hash = ${promptHash}))
       order by m.created_at, m.id
       limit ${MEDIA_PER_RUN}
    ) q`);
  return CountSchema.parse(result.rows[0]).n;
}

/**
 * Each sent script with no synthesis of now: none with the prompt of now nor written by hand (SC-04 lot c5), or one
 * older than a description of its media or its validation (a correction, a new describer, an older row validated).
 * The job waits by itself for what is not described yet.
 */
async function enqueueScripts(
  tx: Transaction,
  creatorId: string | null,
  promptHash: string,
  correlationId: string,
): Promise<number> {
  const result = await tx.execute(sql`
    select count(public.enqueue_job(
      task => 'content_drops.summarize_script',
      payload => jsonb_build_object('creatorId', q.creator_id, 'dropId', q.id, 'correlationId', ${correlationId}::text),
      max_attempts => ${JOB_MAX_ATTEMPTS['content_drops.summarize_script']}::int,
      job_key => 'content_drops.summarize_script:' || q.id,
      job_key_mode => 'preserve_run_at'
    ))::int as n
    from (
      select d.creator_id, d.id
        from content_drops d
        join creators c on c.id = d.creator_id
       where ${switchedOn(creatorId)}
         and d.category = 'script' and d.state not in ('filling', 'withdrawn')
         and not exists (
           select 1 from script_drop_summaries s
            where s.drop_id = d.id and (s.prompt_hash = ${promptHash} or s.author = 'human')
              and s.created_at >= coalesce((
                select max(greatest(md.created_at, md.validated_at)) from media_descriptions md
                  join content_drop_files f on f.media_asset_id = md.media_asset_id
                 where f.drop_id = d.id and f.slot_key is not null and f.replaced_at is null
                   and md.content ? 'detailed'), '-infinity'::timestamptz))
       order by d.created_at, d.id
       limit ${SCRIPTS_PER_RUN}
    ) q`);
  return CountSchema.parse(result.rows[0]).n;
}

/** `content_drops.describe_backlog`, as the owner role. */
export function createDrizzleDescriptionBacklog(adminDb: Database): DescriptionBacklog {
  return {
    enqueue: (creatorId, prompts, correlationId) =>
      withAdmin(adminDb, async (tx) => ({
        media: await enqueueMedia(tx, creatorId, prompts.describe, correlationId),
        scripts: await enqueueScripts(tx, creatorId, prompts.summarize, correlationId),
      })),
  };
}

/**
 * Her switch, the owner's to set (ADR 0083 § 9). Written as the owner role in `creators.settings` (out of RLS, the
 * route admits the owner alone), audited; turned on, her backlog is enqueued in the same transaction.
 */
export function createDrizzleDescribeSwitch(adminDb: Database): DescribeSwitch {
  const { creators } = schema;
  return {
    read: (creatorId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({ settings: creators.settings })
          .from(creators)
          .where(eq(creators.id, creatorId))
          .limit(1);
        return row === undefined ? null : CreatorSettingsSchema.parse(row.settings).describeDrops;
      }),
    set: (creatorId, on, userId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({ settings: creators.settings })
          .from(creators)
          .where(eq(creators.id, creatorId))
          .for('update')
          .limit(1);
        if (row === undefined) return null;
        const was = CreatorSettingsSchema.parse(row.settings).describeDrops;
        if (was === on) return on;
        await tx
          .update(creators)
          .set({ settings: sql`${creators.settings} || jsonb_build_object('describeDrops', ${on}::boolean)` })
          .where(eq(creators.id, creatorId));
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId,
          action: on ? 'creator.describe_drops_on' : 'creator.describe_drops_off',
          entity: 'creator',
          entityId: creatorId,
          details: {},
        });
        if (on)
          await tx.execute(sql`select public.enqueue_job(
            task => 'content_drops.describe_backlog',
            payload => ${JSON.stringify({ creatorId })}::jsonb,
            max_attempts => ${JOB_MAX_ATTEMPTS['content_drops.describe_backlog']}::int,
            job_key => ${`content_drops.describe_backlog:${creatorId}`},
            job_key_mode => 'replace'
          )`);
        return on;
      }),
  };
}
