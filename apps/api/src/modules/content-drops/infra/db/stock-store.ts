import { DESCRIPTION_TRIES, type ReadyVideoTypes } from '@impera/contracts';
import {
  onCreatorList,
  sql,
  withCreatorAccount,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';

import type { StockRow } from '../../application/stock';
import { ContentDropForbidden } from '../../domain/errors';
import type { ReadyVideoLines } from '../../domain/ports';

const readsTeam = (scope: string): boolean => scope === 'owner' || scope === 'agency';

/**
 * Coffre Impera (ADR 0163): each medium of hers still alive in a drop that reached the agency, with where it stands
 * and its description. A file counts when it is kept or a duplicate, not replaced, in a drop not withdrawn (relecture
 * Médias). The newest first; the application counts all of them and keeps the newest for the screen.
 */
async function stockRowsIn(tx: Transaction, creatorId: string): Promise<readonly StockRow[]> {
  const rows = await tx.execute<{
    drop_id: string;
    file_id: string;
    category: string;
    kind: string;
    drop_state: string;
    dropped_at: string | Date;
    out_at: string | Date | null;
    expires_at: string | Date | null;
    erased_at: string | Date | null;
    duration_ms: number | null;
    failures: number | null;
    described: boolean;
    validated: boolean;
    intensity: string | null;
  }>(sql`
    select d.id as drop_id, f.id as file_id, d.category, f.kind, d.state as drop_state,
           d.created_at as dropped_at, d.exported_at as out_at,
           ma.expires_at, ma.erased_at, ma.duration_ms, ma.description_failures as failures,
           shown.id is not null as described, shown.validated_at is not null as validated,
           shown.content ->> 'intensity' as intensity
      from content_drop_files f
      join content_drops d on d.id = f.drop_id
      left join media_assets ma on ma.id = f.media_asset_id
      left join lateral (
        select md.id, md.validated_at, md.content
          from media_descriptions md
         where md.media_asset_id = f.media_asset_id
         order by (md.validated_at is not null) desc, coalesce(md.validated_at, md.created_at) desc
         limit 1
      ) shown on true
     where d.creator_id = ${creatorId}
       and d.state in ('received', 'ready', 'scheduled', 'published')
       and f.state in ('kept', 'duplicate')
       and f.replaced_at is null
     order by d.created_at desc, f.position
  `);
  return rows.rows.map((row) => ({
    dropId: row.drop_id,
    fileId: row.file_id,
    category: row.category,
    kind: row.kind,
    dropState: row.drop_state,
    droppedAt: new Date(row.dropped_at),
    outAt: row.out_at === null ? null : new Date(row.out_at),
    erasesAt: row.erased_at !== null || row.expires_at === null ? null : new Date(row.expires_at),
    durationMs: row.duration_ms,
    description: row.validated
      ? 'validated'
      : row.described
        ? 'to_validate'
        : (row.failures ?? 0) >= DESCRIPTION_TRIES
          ? 'failed'
          : 'pending',
    intensity: row.intensity,
  }));
}

/** Her stock, read by herself (her RLS), by the owner, or by an active manager who has her on his list. */
export interface StockStore {
  forCreator(userId: string): Promise<readonly StockRow[]>;
  forTeam(creatorId: string, userId: string): Promise<readonly StockRow[]>;
  /** The types a video to sell may take (ADR 0163 § 7), for her drop: the owner's lines still offered, names only. */
  readyTypesForCreator(userId: string): Promise<ReadyVideoTypes>;
  /** The same for the team that drops for her, under the same door as her stock. */
  readyTypesForTeam(creatorId: string, userId: string): Promise<ReadyVideoTypes>;
}

const typesOf = async (readyVideos: ReadyVideoLines, creatorId: string): Promise<ReadyVideoTypes> => ({
  types: (await readyVideos(creatorId))
    .filter((line) => line.offered)
    .map((line) => ({ id: line.id, label: line.label })),
});

export function createDrizzleStockStore(
  db: Database,
  readyVideos: ReadyVideoLines = () => Promise.resolve([]),
): StockStore {
  const teamDoor = (creatorId: string, userId: string): Promise<void> =>
    withTenantMember(db, creatorId, userId, async (tx, scope) => {
      if (!readsTeam(scope)) throw new ContentDropForbidden();
      if (scope === 'agency' && !(await onCreatorList(tx, userId, creatorId)))
        throw new ContentDropForbidden();
    });
  return {
    readyTypesForCreator: async (userId) =>
      typesOf(
        readyVideos,
        await withCreatorAccount(db, userId, (_tx, creatorId) => Promise.resolve(creatorId)),
      ),
    readyTypesForTeam: async (creatorId, userId) => {
      await teamDoor(creatorId, userId);
      return typesOf(readyVideos, creatorId);
    },
    forCreator: (userId) => withCreatorAccount(db, userId, (tx, creatorId) => stockRowsIn(tx, creatorId)),
    forTeam: (creatorId, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (!readsTeam(scope)) throw new ContentDropForbidden();
        // An active manager reaches only the creators on his own list (Sécurité, as on the links and the vault).
        if (scope === 'agency' && !(await onCreatorList(tx, userId, creatorId)))
          throw new ContentDropForbidden();
        return stockRowsIn(tx, creatorId);
      }),
  };
}
