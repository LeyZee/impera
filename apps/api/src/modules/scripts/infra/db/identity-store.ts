import {
  AuditEntryIdSchema,
  JOB_MAX_ATTEMPTS,
  newId,
  SCRIPT_IDENTITY_SCHEMA_VERSION,
  ScriptIdentityIdSchema,
  type CreatorId,
} from '@impera/contracts';
import {
  and,
  eq,
  inArray,
  onCreatorList,
  schema,
  sql,
  withAdmin,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';
import { z } from 'zod';

import type { ScriptIdentityJobStore, ScriptIdentityReviewStore } from '../../domain/ports';

import { storedOf } from './platform-script-store';

const { auditLog, creators, mediaDescriptions, platformScripts, scriptIdentities } = schema;

/** At most this many each hour: the rest comes the next hour, those whose identity is the oldest first. */
const SCRIPTS_PER_RUN = 200;

const CountSchema = z.object({ n: z.coerce.number().int() });

/** `scripts.identify_platform_script` for one script, keyed by it: one waiting job whatever asked for it. */
async function enqueueIdentity(
  tx: Transaction,
  job: { readonly creatorId: string; readonly platformScriptId: string; readonly correlationId: string },
): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'scripts.identify_platform_script',
      payload => ${JSON.stringify(job)}::jsonb,
      max_attempts => ${JOB_MAX_ATTEMPTS['scripts.identify_platform_script']}::int,
      job_key => ${`scripts.identify_platform_script:${job.platformScriptId}`},
      job_key_mode => 'preserve_run_at'
    )`,
  );
}

/**
 * The identity job's reads and writes (SC-04 lot c8), as the service role: out of any person, one script at a time.
 * No switch: a script is told once each of its media has a description a person validated (ADR 0145 § 5, 17/11).
 */
export function createDrizzleScriptIdentityJobStore(adminDb: Database): ScriptIdentityJobStore {
  return {
    target: (creatorId, scriptId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({ script: platformScripts })
          .from(platformScripts)
          .innerJoin(creators, eq(creators.id, platformScripts.creatorId))
          .where(
            and(
              eq(platformScripts.id, scriptId),
              eq(platformScripts.creatorId, creatorId),
              eq(platformScripts.active, true),
              sql`${creators.archivedAt} is null`,
            ),
          )
          .limit(1);
        if (row === undefined) return null;
        const [script] = await storedOf(tx, [row.script]);
        if (script === undefined) return null;
        const ids = script.steps
          .flatMap((step) => [...step.media, ...step.previewMedia])
          .flatMap((media) => (media.vault?.descriptionId == null ? [] : [media.vault.descriptionId]));
        const texts =
          ids.length === 0
            ? []
            : await tx
                .select({
                  id: mediaDescriptions.id,
                  detailed: sql<string | null>`${mediaDescriptions.content}->>'detailed'`,
                })
                .from(mediaDescriptions)
                .where(and(inArray(mediaDescriptions.id, ids), eq(mediaDescriptions.creatorId, creatorId)));
        return {
          script,
          descriptions: new Map(
            texts.flatMap((text) => (text.detailed === null ? [] : [[text.id, text.detailed] as const])),
          ),
        };
      }),

    save: (creatorId, scriptId, identity) =>
      withAdmin(adminDb, async (tx) => {
        await tx
          .insert(scriptIdentities)
          .values({
            id: newId(ScriptIdentityIdSchema),
            creatorId,
            platformScriptId: scriptId,
            inputHash: identity.inputHash,
            schemaVersion: SCRIPT_IDENTITY_SCHEMA_VERSION,
            content: identity.content,
            author: 'brain',
            model: identity.model,
            promptHash: identity.promptHash,
          })
          .onConflictDoNothing();
      }),

    enqueueBacklog: (correlationId) =>
      withAdmin(adminDb, async (tx) => {
        const result = await tx.execute(sql`
          select count(public.enqueue_job(
            task => 'scripts.identify_platform_script',
            payload => jsonb_build_object('creatorId', q.creator_id, 'platformScriptId', q.id, 'correlationId', ${correlationId}::text),
            max_attempts => ${JOB_MAX_ATTEMPTS['scripts.identify_platform_script']}::int,
            job_key => 'scripts.identify_platform_script:' || q.id,
            job_key_mode => 'preserve_run_at'
          ))::int as n
          from (
            select s.creator_id, s.id
              from platform_scripts s
              join creators c on c.id = s.creator_id
             where s.active and c.archived_at is null
             order by (select max(i.created_at) from script_identities i where i.platform_script_id = s.id)
                        asc nulls first, s.id
             limit ${SCRIPTS_PER_RUN}
          ) q`);
        return CountSchema.parse(result.rows[0]).n;
      }),

    enqueue: (creatorId, scriptIds, correlationId) =>
      withAdmin(adminDb, async (tx) => {
        for (const platformScriptId of scriptIds)
          await enqueueIdentity(tx, { creatorId, platformScriptId, correlationId });
      }),
  };
}

/**
 * The agency's validation and correction of an identity (ADR 0030 § 3): in the person's transaction, under her RLS
 * and the team's scope (the owner, an active manager of her list, as her scripts are read); her own account is closed
 * by the base. The script is read again in the same transaction, so that an identity of a version changed meanwhile is
 * `stale`. Anyone else gets `not_found`, for a script that exists and one that does not.
 */
export function createDrizzleScriptIdentityReviewStore(db: Database): ScriptIdentityReviewStore {
  return {
    review: (creatorId: CreatorId, scriptId, review, userId, currentHash) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (scope !== 'owner' && scope !== 'agency') return 'not_found';
        if (scope === 'agency' && !(await onCreatorList(tx, userId, creatorId))) return 'not_found';
        const rows = await tx
          .select()
          .from(platformScripts)
          .where(and(eq(platformScripts.id, scriptId), eq(platformScripts.creatorId, creatorId)));
        const [script] = await storedOf(tx, rows);
        if (script === undefined) return 'not_found';
        const inputHash = currentHash(script);
        const audit = (action: string, identityId: string) =>
          tx.insert(auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId,
            action,
            entity: 'platform_script',
            entityId: scriptId,
            details: { identityId, creatorId },
          });

        if (review.kind === 'validate') {
          const identity = script.identities.find((each) => each.id === review.identityId);
          if (identity?.inputHash !== inputHash) return 'stale';
          if (identity.validatedAt !== null) return 'already';
          await tx
            .update(scriptIdentities)
            .set({ validatedBy: userId, validatedAt: sql`now()` })
            .where(and(eq(scriptIdentities.id, identity.id), sql`${scriptIdentities.validatedAt} is null`));
          await audit('script_identity.validated', identity.id);
          return 'validated';
        }

        const id = newId(ScriptIdentityIdSchema);
        await tx.insert(scriptIdentities).values({
          id,
          creatorId,
          platformScriptId: scriptId,
          inputHash,
          schemaVersion: SCRIPT_IDENTITY_SCHEMA_VERSION,
          content: review.content,
          author: 'human',
          validatedBy: userId,
          validatedAt: sql`now()`,
        });
        await audit('script_identity.corrected', id);
        return 'corrected';
      }),
  };
}
