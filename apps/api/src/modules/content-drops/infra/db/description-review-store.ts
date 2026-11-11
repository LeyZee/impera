import {
  AuditEntryIdSchema,
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  DescriptionReviewReasonSchema,
  DropMediaDescriptionSchema,
  DropMediaKindSchema,
  MediaAssetIdSchema,
  MediaDescriptionIdSchema,
  newId,
  ScriptDropSummaryIdSchema,
  ScriptDropSummarySchema,
  ScriptSegmentSchema,
  ScriptSlotKeySchema,
  ScriptSummaryAuthorSchema,
  ScriptSummaryReviewReasonSchema,
  type DropDescriptionsReview,
  type DropMediaReview,
  type ScriptDropSummary,
  type ScriptReviewStep,
  type ScriptSummaryView,
} from '@impera/contracts';
import { and, eq, inArray, schema, sql, withTenantMember, type Database, type Transaction } from '@impera/db';

import {
  mediaHashOf,
  mentionsPrice,
  orderedSummary,
  scriptStepsOf,
  shownRow,
  validationRefusal,
  type ReviewedRow,
} from '../../domain/describe';
import {
  ContentDropForbidden,
  ContentDropNotFound,
  DropDescriptionReviewConflict,
  ScriptSummaryCorrectionUnprocessable,
} from '../../domain/errors';
import type { DescriptionReview, ReviewedFile } from '../../domain/ports';

import { enqueueSummary } from './script-summary-store';

const {
  auditLog,
  contentDropFiles,
  contentDrops,
  contentRequests,
  mediaAssets,
  mediaDescriptions,
  scriptDropSummaries,
  scriptStructureVersions,
} = schema;

const readsTeam = (scope: string): boolean => scope === 'owner' || scope === 'agency';

interface DescriptionRow extends ReviewedRow {
  readonly author: string;
  readonly content: unknown;
  readonly creatorNote: string | null;
  readonly vocabularyVersion: string;
  readonly promptHash: string;
}

interface DropState {
  readonly review: DropDescriptionsReview;
  readonly isScript: boolean;
  readonly rows: readonly DescriptionRow[];
  readonly shown: ReadonlyMap<string, DescriptionRow>;
  /** What the shown synthesis was written for: a correction keeps its media and its prompt. */
  readonly told: { readonly mediaHash: string; readonly promptHash: string } | null;
}

/**
 * The drop as the agency reviews it, under row-level security: each live file with its medium, in the drop's order,
 * the description each is shown with, and for a sent script its latest synthesis, `current` when it was written for
 * the media and descriptions the script shows now (the hash the synthesis job computes, `mediaHashOf`).
 */
async function stateOf(tx: Transaction, dropId: string): Promise<DropState> {
  const [drop] = await tx
    .select({ id: contentDrops.id, category: contentDrops.category, state: contentDrops.state })
    .from(contentDrops)
    .where(eq(contentDrops.id, dropId));
  if (drop === undefined || drop.state === 'withdrawn') throw new ContentDropNotFound();
  const files = await tx
    .select({
      id: contentDropFiles.id,
      slotKey: contentDropFiles.slotKey,
      mediaAssetId: contentDropFiles.mediaAssetId,
      kind: contentDropFiles.kind,
      thumbnailKey: mediaAssets.thumbnailKey,
      erasedAt: mediaAssets.erasedAt,
    })
    .from(contentDropFiles)
    .innerJoin(mediaAssets, eq(mediaAssets.id, contentDropFiles.mediaAssetId))
    .where(
      and(
        eq(contentDropFiles.dropId, dropId),
        sql`${contentDropFiles.replacedAt} is null`,
        sql`${contentDropFiles.state} <> 'refused'`,
        sql`${contentDropFiles.mediaAssetId} is not null`,
      ),
    )
    .orderBy(contentDropFiles.position);
  const withMedium = files.flatMap((file) =>
    file.mediaAssetId === null ? [] : [{ ...file, mediaAssetId: file.mediaAssetId }],
  );
  const mediaIds = [...new Set(withMedium.map((file) => file.mediaAssetId))];
  const rows: DescriptionRow[] =
    mediaIds.length === 0
      ? []
      : await tx
          .select({
            id: mediaDescriptions.id,
            mediaAssetId: mediaDescriptions.mediaAssetId,
            author: mediaDescriptions.author,
            content: mediaDescriptions.content,
            reviewReasons: mediaDescriptions.reviewReasons,
            creatorNote: mediaDescriptions.creatorNote,
            vocabularyVersion: mediaDescriptions.vocabularyVersion,
            promptHash: mediaDescriptions.promptHash,
            validatedAt: mediaDescriptions.validatedAt,
            createdAt: mediaDescriptions.createdAt,
          })
          .from(mediaDescriptions)
          .where(
            and(
              inArray(mediaDescriptions.mediaAssetId, mediaIds),
              // A drop's description, not the short one of a fan's media or of the catalogue (ADR 0083 § 2).
              sql`${mediaDescriptions.content} ? 'detailed'`,
            ),
          );
  const shown = new Map<string, DescriptionRow>();
  for (const mediaAssetId of mediaIds) {
    const row = shownRow(rows.filter((candidate) => candidate.mediaAssetId === mediaAssetId));
    if (row !== null) shown.set(mediaAssetId, row);
  }

  const media: DropMediaReview[] = withMedium.map((file) => {
    const row = shown.get(file.mediaAssetId);
    const content = row === undefined ? null : DropMediaDescriptionSchema.safeParse(row.content);
    return {
      fileId: ContentDropFileIdSchema.parse(file.id),
      slotKey: file.slotKey === null ? null : ScriptSlotKeySchema.parse(file.slotKey),
      mediaAssetId: MediaAssetIdSchema.parse(file.mediaAssetId),
      kind: DropMediaKindSchema.parse(file.kind),
      description:
        row === undefined || content?.success !== true
          ? null
          : {
              id: MediaDescriptionIdSchema.parse(row.id),
              author: row.author === 'human' ? 'human' : 'sense',
              detailed: content.data.detailed,
              reviewReasons: row.reviewReasons.map((reason) => DescriptionReviewReasonSchema.parse(reason)),
              creatorNote: row.creatorNote,
              validatedAt: row.validatedAt?.toISOString() ?? null,
              createdAt: row.createdAt.toISOString(),
            },
      thumbnail: file.thumbnailKey !== null,
      original: file.erasedAt === null,
    };
  });

  const isScript = drop.category === 'script' && drop.state !== 'filling';
  let summary: ScriptSummaryView | null = null;
  let told: DropState['told'] = null;
  let steps: ScriptReviewStep[] = [];
  if (isScript) {
    // The version she shot, frozen: its steps, as her cards name them, each with its files.
    const [version] = await tx
      .select({ segments: scriptStructureVersions.segments })
      .from(contentDrops)
      .innerJoin(contentRequests, eq(contentRequests.id, contentDrops.requestId))
      .innerJoin(scriptStructureVersions, eq(scriptStructureVersions.id, contentRequests.structureVersionId))
      .where(eq(contentDrops.id, dropId));
    if (version !== undefined) {
      const slotted = withMedium.flatMap((file) =>
        file.slotKey === null ? [] : [{ ...file, slotKey: file.slotKey }],
      );
      steps = scriptStepsOf(ScriptSegmentSchema.array().parse(version.segments), slotted).map((step) => ({
        step: step.step,
        code: step.code,
        name: step.name,
        fileIds: step.media.map((file) => ContentDropFileIdSchema.parse(file.id)),
      }));
    }
    const [latest] = await tx
      .select({
        id: scriptDropSummaries.id,
        content: scriptDropSummaries.content,
        reviewReasons: scriptDropSummaries.reviewReasons,
        mediaHash: scriptDropSummaries.mediaHash,
        promptHash: scriptDropSummaries.promptHash,
        author: scriptDropSummaries.author,
        validatedAt: scriptDropSummaries.validatedAt,
        createdAt: scriptDropSummaries.createdAt,
      })
      .from(scriptDropSummaries)
      .where(eq(scriptDropSummaries.dropId, dropId))
      .orderBy(sql`${scriptDropSummaries.createdAt} desc, ${scriptDropSummaries.id} desc`)
      .limit(1);
    if (latest !== undefined) {
      const slots = withMedium.flatMap((file) =>
        file.slotKey === null ? [] : [{ slotKey: file.slotKey, mediaAssetId: file.mediaAssetId }],
      );
      const described = new Map(
        [...shown].map(([mediaAssetId, row]) => [mediaAssetId, { descriptionId: row.id }]),
      );
      told = { mediaHash: latest.mediaHash, promptHash: latest.promptHash };
      summary = {
        id: ScriptDropSummaryIdSchema.parse(latest.id),
        content: ScriptDropSummarySchema.parse(latest.content),
        reviewReasons: latest.reviewReasons.map((reason) => ScriptSummaryReviewReasonSchema.parse(reason)),
        author: ScriptSummaryAuthorSchema.parse(latest.author),
        current: latest.mediaHash === mediaHashOf(slots, described),
        validatedAt: latest.validatedAt?.toISOString() ?? null,
        createdAt: latest.createdAt.toISOString(),
      };
    }
  }

  return {
    review: { dropId: ContentDropIdSchema.parse(drop.id), media, steps, summary },
    isScript,
    rows,
    shown,
    told,
  };
}

async function audit(
  tx: Transaction,
  userId: string,
  action: string,
  dropId: string,
  details: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId,
    action,
    entity: 'content_drop',
    entityId: dropId,
    details,
  });
}

/** The named rows of this drop's media, each once; a row of another drop's media is not found. */
function namedRows(state: DropState, ids: readonly string[]): DescriptionRow[] {
  const named = [...new Set(ids)].map((id) => state.rows.find((row) => row.id === id));
  if (named.some((row) => row === undefined)) throw new ContentDropNotFound();
  return named.filter((row): row is DescriptionRow => row !== undefined);
}

/** The words written by hand over the shown synthesis: its steps, in their order, and never a price (ADR 0056 § 6). */
function correctedSummary(shown: ScriptDropSummary, written: ScriptDropSummary): ScriptDropSummary {
  const ordered = orderedSummary(
    shown.steps.map((one) => one.step),
    written,
  );
  if (ordered === null) throw new ScriptSummaryCorrectionUnprocessable('steps');
  if (mentionsPrice(ordered)) throw new ScriptSummaryCorrectionUnprocessable('price');
  return ordered;
}

/** `withTenantMember` for the owner and an active manager (ADR 0030 § 3): a chatter is refused before any read. */
export function createDrizzleDescriptionReview(db: Database): DescriptionReview {
  const asTeam = <T>(creatorId: string, userId: string, run: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenantMember(db, creatorId, userId, (tx, scope) => {
      if (!readsTeam(scope)) throw new ContentDropForbidden();
      return run(tx);
    });

  return {
    read: (creatorId, userId, dropId) =>
      asTeam(creatorId, userId, async (tx) => (await stateOf(tx, dropId)).review),

    validate: (creatorId, userId, dropId, descriptionIds, now, correlationId) =>
      asTeam(creatorId, userId, async (tx) => {
        const state = await stateOf(tx, dropId);
        const named = namedRows(state, descriptionIds);
        const refusal = validationRefusal(named, (mediaAssetId) => state.shown.get(mediaAssetId) ?? null);
        if (refusal !== null) throw new DropDescriptionReviewConflict(refusal);
        const open = named.filter((row) => row.validatedAt === null).map((row) => row.id);
        if (open.length === 0) return state.review;
        await tx
          .update(mediaDescriptions)
          .set({ validatedBy: userId, validatedAt: now })
          .where(and(inArray(mediaDescriptions.id, open), sql`${mediaDescriptions.validatedAt} is null`));
        await audit(tx, userId, 'media_description.validated', dropId, { descriptionIds: open });
        if (state.isScript) await enqueueSummary(tx, { creatorId, dropId, correlationId }, null);
        return (await stateOf(tx, dropId)).review;
      }),

    correct: (creatorId, userId, dropId, descriptionId, detailed, now, correlationId) =>
      asTeam(creatorId, userId, async (tx) => {
        const state = await stateOf(tx, dropId);
        const [base] = namedRows(state, [descriptionId]);
        if (base === undefined) throw new ContentDropNotFound();
        if (state.shown.get(base.mediaAssetId)?.id !== base.id)
          throw new DropDescriptionReviewConflict('not_shown');
        const content = DropMediaDescriptionSchema.parse(base.content);
        const id = newId(MediaDescriptionIdSchema);
        // A new row (the table is append-only): the vision's closed labels kept, her note kept, the words rewritten.
        await tx.insert(mediaDescriptions).values({
          id,
          creatorId,
          mediaAssetId: base.mediaAssetId,
          vocabularyVersion: base.vocabularyVersion,
          content: { ...content, detailed },
          model: 'human',
          promptHash: base.promptHash,
          author: 'human',
          creatorNote: base.creatorNote,
          reviewReasons: [],
          validatedBy: userId,
          validatedAt: now,
        });
        await audit(tx, userId, 'media_description.corrected', dropId, { from: base.id, to: id });
        if (state.isScript) await enqueueSummary(tx, { creatorId, dropId, correlationId }, null);
        return (await stateOf(tx, dropId)).review;
      }),

    correctSummary: (creatorId, userId, dropId, summaryId, content, now) =>
      asTeam(creatorId, userId, async (tx) => {
        const state = await stateOf(tx, dropId);
        const summary = state.review.summary;
        if (summary?.id !== summaryId || !summary.current || state.told === null)
          throw new DropDescriptionReviewConflict('summary_stale');
        const corrected = correctedSummary(summary.content, content);
        const id = newId(ScriptDropSummaryIdSchema);
        // A new row (written once, validated once): the media and the prompt it corrects kept, the words rewritten.
        await tx.insert(scriptDropSummaries).values({
          id,
          creatorId,
          dropId,
          mediaHash: state.told.mediaHash,
          content: corrected,
          reviewReasons: [],
          model: 'human',
          promptHash: state.told.promptHash,
          author: 'human',
          validatedBy: userId,
          validatedAt: now,
        });
        await audit(tx, userId, 'script_summary.corrected', dropId, { from: summaryId, to: id });
        return (await stateOf(tx, dropId)).review;
      }),

    validateSummary: (creatorId, userId, dropId, summaryId, now) =>
      asTeam(creatorId, userId, async (tx) => {
        const state = await stateOf(tx, dropId);
        const summary = state.review.summary;
        if (summary?.id !== summaryId || !summary.current)
          throw new DropDescriptionReviewConflict('summary_stale');
        if (summary.validatedAt !== null) return state.review;
        await tx
          .update(scriptDropSummaries)
          .set({ validatedBy: userId, validatedAt: now })
          .where(and(eq(scriptDropSummaries.id, summaryId), sql`${scriptDropSummaries.validatedAt} is null`));
        await audit(tx, userId, 'script_summary.validated', dropId, { summaryId });
        return (await stateOf(tx, dropId)).review;
      }),

    file: (creatorId, userId, dropId, fileId) =>
      asTeam(creatorId, userId, async (tx): Promise<ReviewedFile | null> => {
        const [row] = await tx
          .select({
            fileId: contentDropFiles.id,
            mediaAssetId: mediaAssets.id,
            kind: mediaAssets.kind,
            mime: mediaAssets.mime,
            bytes: mediaAssets.bytes,
            storageKey: mediaAssets.storageKey,
            erasedAt: mediaAssets.erasedAt,
            thumbnailKey: mediaAssets.thumbnailKey,
          })
          .from(contentDropFiles)
          .innerJoin(contentDrops, eq(contentDrops.id, contentDropFiles.dropId))
          .innerJoin(mediaAssets, eq(mediaAssets.id, contentDropFiles.mediaAssetId))
          .where(
            and(
              eq(contentDropFiles.id, fileId),
              eq(contentDropFiles.dropId, dropId),
              sql`${contentDropFiles.replacedAt} is null`,
              sql`${contentDropFiles.state} <> 'refused'`,
              sql`${contentDrops.state} <> 'withdrawn'`,
            ),
          );
        if (row === undefined) return null;
        return {
          fileId: row.fileId,
          mediaAssetId: row.mediaAssetId,
          kind: DropMediaKindSchema.parse(row.kind),
          mime: row.mime,
          bytes: row.bytes,
          originalKey: row.erasedAt === null ? row.storageKey : null,
          thumbnailKey: row.thumbnailKey,
        };
      }),

    opened: (creatorId, userId, file, correlationId) =>
      asTeam(creatorId, userId, async (tx) => {
        await tx.insert(auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId,
          action: 'media.opened',
          entity: 'media_asset',
          entityId: file.mediaAssetId,
          details: { fileId: file.fileId, correlationId },
        });
      }),
  };
}
