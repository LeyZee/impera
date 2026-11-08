import { DropMediaDescriptionSchema, MediaDescriptionIdSchema, newId } from '@impera/contracts';
import { and, eq, inArray, schema, sql, withAdmin, type Database } from '@impera/db';

import type { DescribedDrop } from '../application/describe-drop';

/** What the drop descriptions keep, as the owner role: only a job writes the vision AI's rows (ADR 0083 § 1). */
export interface DropDescriptionStore {
  /** Whether the vision AI already described this media of hers for a drop, whatever its describer's version. */
  described(mediaAssetId: string): Promise<boolean>;
  /** The latest detailed description of each of these media that has one, a human's or the vision AI's. */
  detailed(mediaAssetIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** Written once per media and describer: a replayed job writes nothing twice (`media_descriptions_drop_unique`). */
  save(creatorId: string, mediaAssetId: string, described: DescribedDrop): Promise<void>;
}

export function createDrizzleDropDescriptionStore(adminDb: Database): DropDescriptionStore {
  const { mediaDescriptions } = schema;
  return {
    described: (mediaAssetId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({ id: mediaDescriptions.id })
          .from(mediaDescriptions)
          .where(
            and(
              eq(mediaDescriptions.mediaAssetId, mediaAssetId),
              eq(mediaDescriptions.author, 'sense'),
              // A drop's description, not the short one a fan's media or the catalogue gets (ADR 0083 § 2).
              sql`${mediaDescriptions.content} ? 'detailed'`,
            ),
          )
          .limit(1);
        return row !== undefined;
      }),
    detailed: (mediaAssetIds) =>
      withAdmin(adminDb, async (tx) => {
        if (mediaAssetIds.length === 0) return new Map<string, string>();
        const rows = await tx
          .select({ mediaAssetId: mediaDescriptions.mediaAssetId, content: mediaDescriptions.content })
          .from(mediaDescriptions)
          .where(
            and(
              inArray(mediaDescriptions.mediaAssetId, [...mediaAssetIds]),
              sql`${mediaDescriptions.content} ? 'detailed'`,
            ),
          )
          .orderBy(sql`${mediaDescriptions.createdAt} desc, ${mediaDescriptions.id} desc`);
        const latest = new Map<string, string>();
        for (const row of rows) {
          if (latest.has(row.mediaAssetId)) continue;
          const parsed = DropMediaDescriptionSchema.safeParse(row.content);
          if (parsed.success) latest.set(row.mediaAssetId, parsed.data.detailed);
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
