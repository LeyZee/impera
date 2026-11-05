import {
  AuditEntryIdSchema,
  CreatorIdSchema,
  newId,
  ScriptStructureIdSchema,
  ScriptStructureSchema,
  ScriptStructureVersionIdSchema,
  ScriptStructureVersionSchema,
  type CreatorId,
  type ScriptColor,
  type ScriptStructure,
  type ScriptStructureBody,
  type ScriptStructureVersion,
} from '@impera/contracts';
import {
  and,
  enterCreator,
  eq,
  inArray,
  schema,
  sql,
  withMember,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';

import type { QueuedStructure, ScriptStructureStore } from '../../domain/ports';
import { saveDecision } from '../../domain/versions';

type StructureRow = typeof schema.scriptStructures.$inferSelect;
type VersionRow = typeof schema.scriptStructureVersions.$inferSelect;

const structures = schema.scriptStructures;
const versions = schema.scriptStructureVersions;
const queue = schema.scriptStructureQueue;

/**
 * A version frozen before migration 0095 has no `access` on its stages nor `mediaSlots` on its bridges, and never
 * changes again (rule 6): it is read with the defaults ADR 0064 § 3 names, a paid stage and a bridge without slots.
 * What a segment already says wins.
 */
const withSegmentDefaults = (segments: unknown): unknown => {
  if (!Array.isArray(segments)) return segments;
  const listed: readonly unknown[] = segments;
  return listed.map((segment) => {
    if (typeof segment !== 'object' || segment === null || !('kind' in segment)) return segment;
    if (segment.kind === 'stage') return { access: 'paid', ...segment };
    if (segment.kind === 'bridge') return { mediaSlots: [], ...segment };
    return segment;
  });
};

/** A row as the contract has it, parsed: the table is written by this module only, but a row is still a boundary. */
const toVersion = (row: VersionRow): ScriptStructureVersion =>
  ScriptStructureVersionSchema.parse({
    id: row.id,
    version: row.version,
    name: row.name,
    moment: row.moment,
    color: row.color,
    segments: withSegmentDefaults(row.segments),
    frozen: row.frozenAt !== null,
    updatedAt: row.updatedAt.toISOString(),
  });

const toStructure = (row: StructureRow, latest: VersionRow): ScriptStructure =>
  ScriptStructureSchema.parse({
    id: row.id,
    reservedCreatorId: row.reservedCreatorId,
    current: toVersion(latest),
    createdAt: row.createdAt.toISOString(),
  });

/** What a version holds of the body, in the contract's order: two equal bodies give the same text. */
const contentOf = (value: {
  readonly name: string;
  readonly moment: string;
  readonly color: ScriptColor;
  readonly segments: unknown;
}): string =>
  JSON.stringify([
    value.name,
    value.moment,
    [value.color.primary, value.color.secondary, value.color.accent],
    value.segments,
  ]);

const sameBody = (stored: ScriptStructure, body: ScriptStructureBody): boolean =>
  stored.reservedCreatorId === body.reservedCreatorId && contentOf(stored.current) === contentOf(body);

export function createDrizzleScriptStructureStore(db: Database): ScriptStructureStore {
  /** Every creator's id: `creators` is the tenant root, without RLS. */
  const creatorIds = async (tx: Transaction): Promise<CreatorId[]> =>
    (await tx.select({ id: schema.creators.id }).from(schema.creators)).map((row) =>
      CreatorIdSchema.parse(row.id),
    );

  /** The latest version of each structure named. */
  async function latestOf(tx: Transaction, ids: readonly string[]): Promise<Map<string, VersionRow>> {
    const latest = new Map<string, VersionRow>();
    if (ids.length === 0) return latest;
    const rows = await tx
      .select()
      .from(versions)
      .where(inArray(versions.structureId, [...ids]));
    for (const row of rows) {
      const kept = latest.get(row.structureId);
      if (kept === undefined || kept.version < row.version) latest.set(row.structureId, row);
    }
    return latest;
  }

  /** A structure and its latest version, archived ones too; `lock` holds it until the transaction ends. */
  async function load(
    tx: Transaction,
    id: string,
    lock: boolean,
  ): Promise<{ readonly row: StructureRow; readonly latest: VersionRow } | null> {
    const query = tx.select().from(structures).where(eq(structures.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (row === undefined) return null;
    const latest = (await latestOf(tx, [id])).get(id);
    if (latest === undefined) throw new Error('script structure without a version');
    return { row, latest };
  }

  async function audit(
    tx: Transaction,
    action: string,
    entityId: string,
    userId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(schema.auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId,
      action,
      entity: action.startsWith('script_queue') ? 'script_queue' : 'script_structure',
      entityId,
      details,
    });
  }

  /** The creators whose queue holds the structure, under her RLS one at a time. */
  async function queuedOn(tx: Transaction, id: string, creators: readonly CreatorId[]): Promise<CreatorId[]> {
    const holders: CreatorId[] = [];
    for (const creatorId of creators) {
      await enterCreator(tx, creatorId, creators);
      const held = await tx.select({ id: queue.structureId }).from(queue).where(eq(queue.structureId, id));
      if (held.length > 0) holders.push(creatorId);
    }
    return holders;
  }

  /** One writer of a creator's queue at a time, until the transaction ends. */
  const lockQueue = (tx: Transaction, creatorId: string) =>
    tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`scripts.queue:${creatorId}`}, 0))`);

  async function queueOf(tx: Transaction): Promise<QueuedStructure[]> {
    const rows = await tx.select().from(queue).orderBy(queue.position);
    const latest = await latestOf(
      tx,
      rows.map((row) => row.structureId),
    );
    return rows.map((row) => {
      const version = latest.get(row.structureId);
      if (version === undefined) throw new Error('queued structure without a version');
      return { structureId: ScriptStructureIdSchema.parse(row.structureId), current: toVersion(version) };
    });
  }

  return {
    list: (userId) =>
      withMember(db, userId, async (tx) => {
        const rows = await tx
          .select()
          .from(structures)
          .where(sql`${structures.archivedAt} is null`)
          .orderBy(sql`${structures.createdAt} desc`, structures.id);
        const latest = await latestOf(
          tx,
          rows.map((row) => row.id),
        );
        return {
          structures: rows.flatMap((row) => {
            const version = latest.get(row.id);
            return version === undefined ? [] : [toStructure(row, version)];
          }),
        };
      }),

    get: (id, userId) =>
      withMember(db, userId, async (tx) => {
        const found = await load(tx, id, false);
        return found?.row.archivedAt !== null ? null : toStructure(found.row, found.latest);
      }),

    create: (body, userId) =>
      withMember(db, userId, async (tx) => {
        if (body.reservedCreatorId !== null && !(await creatorIds(tx)).includes(body.reservedCreatorId))
          return { kind: 'creator_invalid' } as const;
        const inserted = await tx
          .insert(structures)
          .values({ id: body.id, reservedCreatorId: body.reservedCreatorId, createdBy: userId })
          .onConflictDoNothing()
          .returning({ id: structures.id });
        if (inserted.length === 0) {
          const found = await load(tx, body.id, false);
          if (found?.row.archivedAt !== null) return { kind: 'conflict' } as const;
          const stored = toStructure(found.row, found.latest);
          return sameBody(stored, body)
            ? ({ kind: 'replayed', structure: stored } as const)
            : ({ kind: 'conflict' } as const);
        }
        await tx.insert(versions).values({
          id: newId(ScriptStructureVersionIdSchema),
          structureId: body.id,
          version: 1,
          name: body.name,
          moment: body.moment,
          color: body.color,
          segments: body.segments,
          updatedBy: userId,
        });
        await audit(tx, 'script_structure.create', body.id, userId, { version: 1 });
        const found = await load(tx, body.id, false);
        if (found === null) throw new Error('script structure written but not read back');
        return { kind: 'created', structure: toStructure(found.row, found.latest) } as const;
      }),

    save: (id, body, userId) =>
      withMember(db, userId, async (tx) => {
        const found = await load(tx, id, true);
        if (found?.row.archivedAt !== null) return 'not_found';
        const decision = saveDecision(
          { version: found.latest.version, frozen: found.latest.frozenAt !== null },
          body.basedOnVersion,
        );
        if (decision === 'stale') return 'stale';
        if (body.reservedCreatorId !== null) {
          const creators = await creatorIds(tx);
          if (!creators.includes(body.reservedCreatorId)) return 'creator_invalid';
          const holders = await queuedOn(tx, id, creators);
          if (holders.some((creatorId) => creatorId !== body.reservedCreatorId)) return 'creator_invalid';
        }
        const content = {
          name: body.name,
          moment: body.moment,
          color: body.color,
          segments: body.segments,
          updatedBy: userId,
        };
        if (decision === 'update')
          await tx
            .update(versions)
            .set({ ...content, updatedAt: sql`now()` })
            .where(eq(versions.id, found.latest.id));
        else
          await tx.insert(versions).values({
            id: newId(ScriptStructureVersionIdSchema),
            structureId: id,
            version: found.latest.version + 1,
            ...content,
          });
        if (body.reservedCreatorId !== found.row.reservedCreatorId)
          await tx
            .update(structures)
            .set({ reservedCreatorId: body.reservedCreatorId })
            .where(eq(structures.id, id));
        const saved = await load(tx, id, false);
        if (saved === null) throw new Error('script structure saved but not read back');
        await audit(tx, 'script_structure.update', id, userId, { version: saved.latest.version, decision });
        return toStructure(saved.row, saved.latest);
      }),

    archive: (id, userId) =>
      withMember(db, userId, async (tx) => {
        const found = await load(tx, id, true);
        if (found?.row.archivedAt !== null) return false;
        await tx
          .update(structures)
          .set({ archivedAt: sql`now()` })
          .where(eq(structures.id, id));
        const creators = await creatorIds(tx);
        const removedFrom: CreatorId[] = [];
        for (const creatorId of creators) {
          await enterCreator(tx, creatorId, creators);
          await lockQueue(tx, creatorId);
          const removed = await tx
            .delete(queue)
            .where(eq(queue.structureId, id))
            .returning({ creatorId: queue.creatorId });
          if (removed.length > 0) removedFrom.push(creatorId);
        }
        await audit(tx, 'script_structure.archive', id, userId, { removedFrom });
        return true;
      }),

    freeze: (id, userId) =>
      withMember(db, userId, async (tx) => {
        const found = await load(tx, id, true);
        if (found?.row.archivedAt !== null) return null;
        if (found.latest.frozenAt !== null) return toVersion(found.latest);
        const [frozen] = await tx
          .update(versions)
          .set({ frozenAt: sql`now()`, updatedBy: userId })
          .where(eq(versions.id, found.latest.id))
          .returning();
        if (frozen === undefined) throw new Error('script structure version not frozen');
        await audit(tx, 'script_structure.freeze', id, userId, { version: frozen.version });
        return toVersion(frozen);
      }),

    // `creators` is out of RLS: only the owner and an active manager (scope `owner` | `agency`) read a queue, so anyone
    // else gets the same 404 for a creator that exists and one that does not, never her existence (recette SEC-06).
    queue: (creatorId, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) =>
        (scope === 'owner' || scope === 'agency') && (await creatorIds(tx)).includes(creatorId)
          ? queueOf(tx)
          : null,
      ),

    setQueue: (creatorId, ids, userId, vet) =>
      withTenantMember(db, creatorId, userId, async (tx) => {
        if (!(await creatorIds(tx)).includes(creatorId)) return { kind: 'creator_not_found' } as const;
        await lockQueue(tx, creatorId);
        const rows =
          ids.length === 0
            ? []
            : await tx
                .select()
                .from(structures)
                .where(
                  and(
                    inArray(structures.id, [...ids]),
                    sql`${structures.archivedAt} is null`,
                    sql`(${structures.reservedCreatorId} is null or ${structures.reservedCreatorId} = ${creatorId})`,
                  ),
                )
                .for('share');
        const allowed = new Set(rows.map((row) => row.id));
        const refused = ids.filter((id) => !allowed.has(id));
        if (refused.length > 0) return { kind: 'unprocessable', structureIds: refused } as const;
        const latest = await latestOf(tx, ids);
        const entries = ids.map((structureId): QueuedStructure => {
          const version = latest.get(structureId);
          if (version === undefined) throw new Error('script structure without a version');
          return { structureId, current: toVersion(version) };
        });
        const refusals = vet(entries);
        if (refusals.length > 0) return { kind: 'blocked', refusals } as const;
        await tx.delete(queue).where(eq(queue.creatorId, creatorId));
        if (ids.length > 0)
          await tx.insert(queue).values(
            ids.map((structureId, index) => ({
              creatorId,
              position: index + 1,
              structureId,
              addedBy: userId,
            })),
          );
        await audit(tx, 'script_queue.update', creatorId, userId, { structureIds: ids });
        return { kind: 'written', entries } as const;
      }),
  };
}
