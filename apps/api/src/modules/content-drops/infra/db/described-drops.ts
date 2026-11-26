import { and, eq, inArray, schema, sql, withTenantJob, type Database } from '@impera/db';

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
 * not replaced. Read in her creator under the app role, as the jobs on a medium she dropped are (`drop_media`,
 * ADR 0087 lot c): never the service role.
 */
export async function dropsOfMedium(
  db: Database,
  creatorId: string,
  mediaAssetId: string,
): Promise<DropOfMedium[]> {
  const held = await liveDrops(db, creatorId, { mediaAssetId });
  return held.map(({ dropId, category, sentence, durationS, dueOn }) => ({
    dropId,
    category,
    sentence,
    durationS,
    dueOn,
  }));
}

/** A live drop of a creator with each medium it holds now, by the same rules and under the same door; empty for none. */
export function mediaOfDrop(
  db: Database,
  creatorId: string,
  dropId: string,
): Promise<(DropOfMedium & { readonly mediaAssetId: string })[]> {
  return liveDrops(db, creatorId, { dropId });
}

function liveDrops(
  db: Database,
  creatorId: string,
  by: { readonly mediaAssetId: string } | { readonly dropId: string },
): Promise<(DropOfMedium & { readonly mediaAssetId: string })[]> {
  return withTenantJob(db, creatorId, 'drop_media', async (tx) => {
    const rows = await tx
      .selectDistinct({
        dropId: contentDrops.id,
        mediaAssetId: mediaAssets.id,
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
          'dropId' in by
            ? eq(contentDrops.id, by.dropId)
            : eq(contentDropFiles.mediaAssetId, by.mediaAssetId),
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
