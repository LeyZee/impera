import { schema, sql, withAdmin, type Database } from '@impera/db';
import { z } from 'zod';

import type { VaultLinks } from '../../domain/ports';

const LinkRowSchema = z.object({
  platform_media_id: z.string(),
  media_asset_id: z.uuid().nullable(),
  described: z.boolean(),
});

/**
 * Where the media of a native script stand in her vault (`media_platform_refs`, written by the vault sync, fiche
 * vault-sync), read as the service role and bounded by the account: a link the platform no longer lists
 * (`removed_at`) is not in the vault. `described`: its media has a description a human validated (ADR 0083), as the
 * drops read it.
 */
export function createDrizzleVaultLinks(adminDb: Database): VaultLinks {
  return async (platformAccountId, mediaRefs) => {
    if (mediaRefs.length === 0) return new Map();
    const refs = sql.join(
      [...new Set(mediaRefs)].map((ref) => sql`${ref}`),
      sql`, `,
    );
    const result = await withAdmin(adminDb, (tx) =>
      tx.execute(sql`
        select l.platform_media_id, l.media_asset_id,
          (l.media_asset_id is not null and exists (
            select 1 from ${schema.mediaDescriptions} md
            where md.media_asset_id = l.media_asset_id and md.validated_at is not null
          )) as described
        from ${schema.mediaPlatformRefs} l
        where l.platform_account_id = ${platformAccountId}::uuid
          and l.platform_media_id in (${refs})
          and l.removed_at is null`),
    );
    return new Map(
      z
        .array(LinkRowSchema)
        .parse(result.rows)
        .map((row) => [
          row.platform_media_id,
          { mediaAssetId: row.media_asset_id, described: row.described },
        ]),
    );
  };
}
