import {
  AuditEntryIdSchema,
  CustomPriceGridSchema,
  emptyCustomPriceGrid,
  newId,
  type CreatorId,
  type CustomPriceGrid,
  type CustomPriceGridView,
} from '@impera/contracts';
import { eq, schema, sql, withTenantMember, type Database, type Transaction } from '@impera/db';

import type { CustomPriceActor, CustomPriceGridStore } from '../../domain/ports';

const { auditLog, creators, customPriceGrids } = schema;

interface GridRow {
  readonly version: number;
  readonly grid: unknown;
  readonly createdBy: string | null;
  readonly createdAt: Date;
}

/** The latest version of her grid, as the role at hand reads it. */
async function latest(tx: Transaction, creatorId: CreatorId): Promise<GridRow | undefined> {
  const [row] = await tx
    .select({
      version: customPriceGrids.version,
      grid: customPriceGrids.grid,
      createdBy: customPriceGrids.createdBy,
      createdAt: customPriceGrids.createdAt,
    })
    .from(customPriceGrids)
    .where(eq(customPriceGrids.creatorId, creatorId))
    .orderBy(sql`${customPriceGrids.version} desc`)
    .limit(1);
  return row;
}

/** A row as the contract has it, parsed: written by this module only, but a row is still a boundary. */
function viewOf(creatorId: CreatorId, row: GridRow | undefined): CustomPriceGridView {
  return row === undefined
    ? { creatorId, version: 0, grid: emptyCustomPriceGrid(), updatedAt: null }
    : {
        creatorId,
        version: row.version,
        grid: CustomPriceGridSchema.parse(row.grid),
        updatedAt: row.createdAt.toISOString(),
      };
}

/** The same grid, key order aside: both sides parsed by the contract, which writes its keys in one order. */
const sameGrid = (a: CustomPriceGrid, b: CustomPriceGrid): boolean =>
  JSON.stringify(CustomPriceGridSchema.parse(a)) === JSON.stringify(CustomPriceGridSchema.parse(b));

/**
 * Her grid (ADR 0159 § C). Read as the signed-in account under her RLS, where only the owner's scope sees a row; the
 * right is read in the base, never from the session. Written in that same transaction, by the application role under
 * the `owner_insert` policy (no service role: nothing crosses creators), under a lock per creator, one version on top
 * of the one the screen read.
 */
export function createDrizzleCustomPriceGridStore(db: Database): CustomPriceGridStore {
  /** The owner's right on an existing creator, then `fn` under her RLS; null for anyone else or no such creator. */
  const asOwner = <T>(
    creatorId: CreatorId,
    actor: CustomPriceActor,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T | null> =>
    withTenantMember(db, creatorId, actor.userId, async (tx, scope) => {
      if (scope !== 'owner') return null;
      // `creators` is the tenant root, without RLS: the same answer for a creator that does not exist.
      const [creator] = await tx.select({ id: creators.id }).from(creators).where(eq(creators.id, creatorId));
      return creator === undefined ? null : fn(tx);
    });

  return {
    read: (creatorId, actor) =>
      asOwner(creatorId, actor, async (tx) => viewOf(creatorId, await latest(tx, creatorId))),

    save: (creatorId, baseVersion, grid, actor) =>
      asOwner(creatorId, actor, async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`custom_price_grids:${creatorId}`}, 0))`,
        );
        const current = await latest(tx, creatorId);
        const currentVersion = current?.version ?? 0;
        // The same save again (a replay, a double tap): the version it made, nothing written.
        if (
          current !== undefined &&
          currentVersion === baseVersion + 1 &&
          current.createdBy === actor.userId &&
          sameGrid(CustomPriceGridSchema.parse(current.grid), grid)
        )
          return { kind: 'saved', view: viewOf(creatorId, current) };
        if (currentVersion !== baseVersion) return { kind: 'conflict', current: currentVersion };
        const [row] = await tx
          .insert(customPriceGrids)
          .values({ creatorId, version: baseVersion + 1, grid, createdBy: actor.userId })
          .returning({
            version: customPriceGrids.version,
            grid: customPriceGrids.grid,
            createdBy: customPriceGrids.createdBy,
            createdAt: customPriceGrids.createdAt,
          });
        if (row === undefined) throw new Error('custom price grid not written');
        // The audit says a version was saved and how big the grid is, never a price (methods of the agency).
        await tx.insert(auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: actor.userId,
          action: 'custom_price_grid.save',
          entity: 'custom_price_grid',
          entityId: creatorId,
          ip: actor.ip,
          details: {
            version: row.version,
            formatsOffered: grid.formats.filter((line) => line.offered).length,
            supplements: grid.supplements.length,
          },
        });
        return { kind: 'saved', view: viewOf(creatorId, row) };
      }),
  };
}
