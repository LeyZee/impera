import { DropCategorySchema, type DropCategory } from '@impera/contracts';
import { and, eq, inArray, schema, sql, type Transaction } from '@impera/db';

const { contentDrops, contentRequests, scriptStructureVersions } = schema;

/** A drop that reached the agency and is not out yet: the stock a week counts on (ADR 0140 § 4). */
const IN_STOCK = ['received', 'ready', 'scheduled'] as const;
/** A drop that reached the agency, out or not: what her delivery counts (ADR 0140 § 25). */
const ARRIVED = ['received', 'ready', 'scheduled', 'published'] as const;
/** A script request is answered once a drop of it is on its way or arrived; a script still being filled is not. */
const ANSWERING = ['uploading', ...ARRIVED] as const;

/** A script asked of her and not answered yet, with the name of its structure as asked. */
interface OpenScriptRequest {
  readonly requestId: string;
  readonly name: string | null;
  readonly dueOn: string;
}

/** What her week is computed on (ADR 0140 § 4): her stock by category, and her scripts asked due by `dueBy`. */
export interface WeekStockFacts {
  readonly stock: Readonly<Partial<Record<DropCategory, number>>>;
  readonly scripts: readonly OpenScriptRequest[];
}

/**
 * Her stock and her open script requests, as the week's job reads them: the module owns them, the week gets this
 * function through the module's `index.ts`, never the tables. On the admin connection, bounded to her; nothing written.
 */
export async function weekStockUnscoped(
  tx: Transaction,
  creatorId: string,
  dueBy: string,
): Promise<WeekStockFacts> {
  const counted = await tx
    .select({ category: contentDrops.category, count: sql<number>`count(*)::int` })
    .from(contentDrops)
    .where(
      and(
        eq(contentDrops.creatorId, creatorId),
        inArray(contentDrops.state, [...IN_STOCK]),
        sql`${contentDrops.exportedAt} is null`,
      ),
    )
    .groupBy(contentDrops.category);
  const stock: Partial<Record<DropCategory, number>> = {};
  for (const row of counted) stock[DropCategorySchema.parse(row.category)] = row.count;
  const open = await tx
    .select({
      requestId: contentRequests.id,
      name: scriptStructureVersions.name,
      dueOn: contentRequests.dueOn,
    })
    .from(contentRequests)
    .leftJoin(scriptStructureVersions, eq(scriptStructureVersions.id, contentRequests.structureVersionId))
    .where(
      and(
        eq(contentRequests.creatorId, creatorId),
        eq(contentRequests.category, 'script'),
        eq(contentRequests.state, 'open'),
        sql`${contentRequests.dueOn} <= ${dueBy}`,
        sql`not exists (
          select 1 from content_drops d
           where d.request_id = ${contentRequests.id} and d.state in ${sql.raw(`(${ANSWERING.map((state) => `'${state}'`).join(', ')})`)}
        )`,
      ),
    )
    .orderBy(contentRequests.dueOn, contentRequests.createdAt);
  return { stock, scripts: open };
}

/**
 * What of her delivery arrived (ADR 0140 § 25): her drops by category that reached the agency between two instants,
 * and which of `requestIds` a drop answers, whenever it came. Read in her own account, in her request (her RLS).
 */
export async function weekArrivals(
  tx: Transaction,
  creatorId: string,
  window: { readonly from: Date; readonly to: Date },
  requestIds: readonly string[],
): Promise<{
  readonly byCategory: Readonly<Partial<Record<DropCategory, number>>>;
  readonly answered: ReadonlySet<string>;
}> {
  const counted = await tx
    .select({ category: contentDrops.category, count: sql<number>`count(*)::int` })
    .from(contentDrops)
    .where(
      and(
        eq(contentDrops.creatorId, creatorId),
        inArray(contentDrops.state, [...ARRIVED]),
        sql`${contentDrops.createdAt} >= ${window.from} and ${contentDrops.createdAt} < ${window.to}`,
      ),
    )
    .groupBy(contentDrops.category);
  const byCategory: Partial<Record<DropCategory, number>> = {};
  for (const row of counted) byCategory[DropCategorySchema.parse(row.category)] = row.count;
  const answered =
    requestIds.length === 0
      ? []
      : await tx
          .select({ requestId: contentDrops.requestId })
          .from(contentDrops)
          .where(
            and(
              eq(contentDrops.creatorId, creatorId),
              inArray(contentDrops.requestId, [...requestIds]),
              inArray(contentDrops.state, [...ARRIVED]),
            ),
          );
  return {
    byCategory,
    answered: new Set(answered.flatMap((row) => (row.requestId === null ? [] : [row.requestId]))),
  };
}
