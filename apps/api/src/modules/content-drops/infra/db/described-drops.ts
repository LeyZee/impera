import { and, eq, inArray, schema, sql, withAdmin, type Database } from '@impera/db';

const { contentDropFiles, contentDrops, contentRequests, mediaAssets } = schema;

/** A live drop that holds a medium, as whoever waits for its description reads it. Never the medium nor its address. */
export interface DropOfMedium {
  readonly dropId: string;
  readonly category: string;
  /** What she wrote with her drop: her own free text, a data for whoever reads it. */
  readonly sentence: string | null;
  readonly durationS: number | null;
  /** The day of the request this drop answers; `null` for a drop of her own. */
  readonly dueOn: string | null;
}

/**
 * The live drops of a creator that hold this medium: neither being filled, blocked nor withdrawn, the file kept and
 * not replaced. As the owner role, bounded by the creator the job names.
 */
export function dropsOfMedium(
  adminDb: Database,
  creatorId: string,
  mediaAssetId: string,
): Promise<DropOfMedium[]> {
  return withAdmin(adminDb, async (tx) => {
    const rows = await tx
      .selectDistinct({
        dropId: contentDrops.id,
        category: contentDrops.category,
        sentence: contentDrops.sentence,
        durationMs: mediaAssets.durationMs,
        dueOn: contentRequests.dueOn,
      })
      .from(contentDropFiles)
      .innerJoin(contentDrops, eq(contentDrops.id, contentDropFiles.dropId))
      .innerJoin(mediaAssets, eq(mediaAssets.id, contentDropFiles.mediaAssetId))
      .leftJoin(contentRequests, eq(contentRequests.id, contentDrops.requestId))
      .where(
        and(
          eq(contentDrops.creatorId, creatorId),
          eq(contentDropFiles.mediaAssetId, mediaAssetId),
          inArray(contentDropFiles.state, ['kept', 'duplicate']),
          sql`${contentDropFiles.replacedAt} is null`,
          sql`${contentDrops.state} not in ('filling', 'blocked', 'withdrawn')`,
        ),
      );
    return rows.map(({ durationMs, ...row }) => ({
      ...row,
      durationS: durationMs === null ? null : durationMs / 1000,
    }));
  });
}
