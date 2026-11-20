import {
  AuditEntryIdSchema,
  DropMediaDescriptionSchema,
  JOB_MAX_ATTEMPTS,
  MediaDescriptionIdSchema,
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

import { descriptionRefusal } from '../../domain/platform-scripts';
import type { ScriptIdentityJobStore, ScriptIdentityReviewStore, ShownDescription } from '../../domain/ports';

import { storedOf } from './platform-script-store';

const { auditLog, creators, mediaDescriptions, platformScripts, scriptIdentities } = schema;

/** At most this many each hour: the rest comes the next hour, those whose identity is the oldest first. */
const SCRIPTS_PER_RUN = 200;

const CountSchema = z.object({ n: z.coerce.number().int() });

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
  };
}

/**
 * The agency's validation and correction of an identity (ADR 0030 § 3): in the person's transaction, under her RLS
 * and the team's scope (the owner, an active manager of her list, as her scripts are read); her own account is closed
 * by the base. The script is read again in the same transaction, so that an identity of a version changed meanwhile is
 * `stale`. Anyone else gets `not_found`, for a script that exists and one that does not.
 */
export function createDrizzleScriptIdentityReviewStore(db: Database): ScriptIdentityReviewStore {
  /** The script as the person's transaction reads it, or `null`: not hers, or not one he may review. */
  const reviewed = async (
    tx: Transaction,
    scope: string,
    creatorId: CreatorId,
    scriptId: string,
    userId: string,
  ) => {
    if (scope !== 'owner' && scope !== 'agency') return null;
    if (scope === 'agency' && !(await onCreatorList(tx, userId, creatorId))) return null;
    const rows = await tx
      .select()
      .from(platformScripts)
      .where(and(eq(platformScripts.id, scriptId), eq(platformScripts.creatorId, creatorId)));
    const [script] = await storedOf(tx, rows);
    return script ?? null;
  };

  return {
    describe: (creatorId: CreatorId, scriptId, review, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        const script = await reviewed(tx, scope, creatorId, scriptId, userId);
        if (script === null) return 'not_found';
        // The descriptions its media are shown with now, sold and previews, each with the media it tells.
        const shown = new Map<string, ShownDescription & { readonly mediaAssetId: string }>();
        for (const step of script.steps)
          for (const media of [...step.media, ...step.previewMedia]) {
            const vault = media.vault;
            if (vault?.shown != null && vault.mediaAssetId !== null)
              shown.set(vault.shown.id, { ...vault.shown, mediaAssetId: vault.mediaAssetId });
          }
        const named =
          review.kind === 'validate' ? [...new Set(review.descriptionIds)] : [review.descriptionId];
        const refusal = descriptionRefusal(named, shown);
        if (refusal !== null) return refusal;
        const audit = (action: string, details: Record<string, unknown>) =>
          tx.insert(auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId,
            action,
            entity: 'platform_script',
            entityId: scriptId,
            details: { ...details, creatorId },
          });
        if (review.kind === 'validate') {
          const open = named.filter((id) => shown.get(id)?.validated === false);
          if (open.length === 0) return 'already';
          await tx
            .update(mediaDescriptions)
            .set({ validatedBy: userId, validatedAt: sql`now()` })
            .where(
              and(
                inArray(mediaDescriptions.id, open),
                eq(mediaDescriptions.creatorId, creatorId),
                sql`${mediaDescriptions.validatedAt} is null`,
              ),
            );
          // A reason lifted by a person (a doubt, a safety flag) stays in the trail, with who lifted it.
          const lifted = open.flatMap((id) => {
            const reasons = shown.get(id)?.reviewReasons ?? [];
            return reasons.length === 0 ? [] : [{ descriptionId: id, reasons }];
          });
          await audit('media_description.validated', { descriptionIds: open, lifted });
          return 'validated';
        }

        const [base] = await tx
          .select()
          .from(mediaDescriptions)
          .where(
            and(eq(mediaDescriptions.id, review.descriptionId), eq(mediaDescriptions.creatorId, creatorId)),
          );
        const content = DropMediaDescriptionSchema.safeParse(base?.content);
        if (base === undefined || !content.success) return 'stale';
        const id = newId(MediaDescriptionIdSchema);
        // A new row (the table is append-only): the vision's closed labels kept, the words rewritten, validated.
        await tx.insert(mediaDescriptions).values({
          id,
          creatorId,
          mediaAssetId: base.mediaAssetId,
          vocabularyVersion: base.vocabularyVersion,
          content: { ...content.data, detailed: review.detailed },
          model: 'human',
          promptHash: base.promptHash,
          author: 'human',
          creatorNote: base.creatorNote,
          reviewReasons: [],
          validatedBy: userId,
          validatedAt: sql`now()`,
        });
        await audit('media_description.corrected', {
          from: base.id,
          to: id,
          lifted:
            base.reviewReasons.length === 0 ? [] : [{ descriptionId: base.id, reasons: base.reviewReasons }],
        });
        return 'corrected';
      }),
  };
}
