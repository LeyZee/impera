import type { CreatorId, MediaAssetId } from '@nirvana/contracts';
import { inArray, schema, sql, withTenant, type Database } from '@nirvana/db';
import { z } from 'zod';

/** The one line Suivi shows of a stored description: read alone, so an older vocabulary still says what it shows. */
const ShownSchema = z.object({ factualDescription: z.string().min(1) });

/** The latest description the module kept of each media, read under her RLS (SUIVI-26). */
export interface DescriptionReader {
  of(creatorId: CreatorId, mediaAssetIds: readonly MediaAssetId[]): Promise<ReadonlyMap<string, string>>;
}

export function createDrizzleDescriptionReader(db: Database): DescriptionReader {
  return {
    of: (creatorId, mediaAssetIds) =>
      withTenant(db, creatorId, async (tx) => {
        const shown = new Map<string, string>();
        if (mediaAssetIds.length === 0) return shown;
        const rows = await tx
          .selectDistinctOn([schema.mediaDescriptions.mediaAssetId], {
            mediaAssetId: schema.mediaDescriptions.mediaAssetId,
            content: schema.mediaDescriptions.content,
          })
          .from(schema.mediaDescriptions)
          .where(inArray(schema.mediaDescriptions.mediaAssetId, [...mediaAssetIds]))
          // Two descriptions kept by one transaction share their date: the id breaks the tie, never chance.
          .orderBy(
            schema.mediaDescriptions.mediaAssetId,
            sql`${schema.mediaDescriptions.createdAt} desc`,
            sql`${schema.mediaDescriptions.id} desc`,
          );
        for (const row of rows) {
          const content = ShownSchema.safeParse(row.content);
          if (content.success) shown.set(row.mediaAssetId, content.data.factualDescription);
        }
        return shown;
      }),
  };
}
