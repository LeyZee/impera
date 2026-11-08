import { DropMediaDescriptionSchema, MediaDescriptionIdSchema, newId } from '@impera/contracts';
import { and, eq, inArray, schema, sql, withAdmin, type Database } from '@impera/db';

import type { DescribedDrop } from '../application/describe-drop';

/** What the drop descriptions keep, as the owner role: only a job writes the vision AI's rows (ADR 0083 § 1). */
export interface DropDescriptionStore {
  /**
   * Whether this media of hers needs no new description: a human wrote one, or the vision AI described it for a drop
   * with this version of the prompt (ADR 0083 § 2: a new version describes it again, never over a human's).
   */
  described(mediaAssetId: string, promptHash: string): Promise<boolean>;
  /** The latest detailed description of each of these media that has one, a human's or the vision AI's. */
  detailed(mediaAssetIds: readonly string[]): Promise<ReadonlyMap<string, DetailedDescription>>;
  /** Written once per media and describer: a replayed job writes nothing twice (`media_descriptions_drop_unique`). */
  save(creatorId: string, mediaAssetId: string, described: DescribedDrop): Promise<void>;
}

/** A media's latest detailed description, and the row it comes from (a correction is a new row). */
export interface DetailedDescription {
  readonly descriptionId: string;
  readonly detailed: string;
}

export function createDrizzleDropDescriptionStore(adminDb: Database): DropDescriptionStore {
  const { mediaDescriptions } = schema;
  return {
    described: (mediaAssetId, promptHash) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({ id: mediaDescriptions.id })
          .from(mediaDescriptions)
          .where(
            and(
              eq(mediaDescriptions.mediaAssetId, mediaAssetId),
              // A drop's description, not the short one a fan's media or the catalogue gets (ADR 0083 § 2).
              sql`${mediaDescriptions.content} ? 'detailed'`,
              sql`(${mediaDescriptions.author} = 'human' or ${mediaDescriptions.promptHash} = ${promptHash})`,
            ),
          )
          .limit(1);
        return row !== undefined;
      }),
    detailed: (mediaAssetIds) =>
      withAdmin(adminDb, async (tx) => {
        const latest = new Map<string, DetailedDescription>();
        if (mediaAssetIds.length === 0) return latest;
        const rows = await tx
          .select({
            id: mediaDescriptions.id,
            mediaAssetId: mediaDescriptions.mediaAssetId,
            content: mediaDescriptions.content,
          })
          .from(mediaDescriptions)
          .where(
            and(
              inArray(mediaDescriptions.mediaAssetId, [...mediaAssetIds]),
              sql`${mediaDescriptions.content} ? 'detailed'`,
            ),
          )
          .orderBy(sql`${mediaDescriptions.createdAt} desc, ${mediaDescriptions.id} desc`);
        for (const row of rows) {
          if (latest.has(row.mediaAssetId)) continue;
          const parsed = DropMediaDescriptionSchema.safeParse(row.content);
          if (parsed.success)
            latest.set(row.mediaAssetId, { descriptionId: row.id, detailed: parsed.data.detailed });
        }
        return latest;
      }),
    save: (creatorId, mediaAssetId, described) =>
      withAdmin(adminDb, async (tx) => {
        await tx
          .insert(mediaDescriptions)
          .values({
            id: newId(MediaDescriptionIdSchema),
            creatorId,
            mediaAssetId,
            vocabularyVersion: described.description.vocabularyVersion,
            content: described.description,
            model: described.model,
            promptHash: described.promptHash,
            author: 'sense',
            reviewReasons: [...described.reviewReasons],
          })
          .onConflictDoNothing();
      }),
  };
}
