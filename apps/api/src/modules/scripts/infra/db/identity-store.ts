import {
  AuditEntryIdSchema,
  DropMediaDescriptionSchema,
  MediaDescriptionIdSchema,
  newId,
  type CreatorId,
} from '@impera/contracts';
import {
  and,
  eq,
  inArray,
  onCreatorList,
  schema,
  sql,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';

import { descriptionRefusal } from '../../domain/platform-scripts';
import type { ScriptIdentityReviewStore, ShownDescription } from '../../domain/ports';

import { storedOf } from './platform-script-store';

const { auditLog, mediaDescriptions, platformScripts } = schema;

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
