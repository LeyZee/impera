import {
  AuditEntryIdSchema,
  CreatorIdSchema,
  newId,
  SCRIPT_CADENCE_DEFAULT_DAYS,
  ScriptCadenceOutcomeSchema,
  ScriptCadenceSkipSchema,
  ScriptStructureIdSchema,
  ScriptStructureVersionSchema,
  type CreatorId,
  type ScriptStructureVersion,
} from '@impera/contracts';
import {
  and,
  eq,
  schema,
  sql,
  withAdmin,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';
import { z } from 'zod';

import type { CadenceStore, QueuedStructure, StoredCadence } from '../../domain/ports';

type VersionRow = typeof schema.scriptStructureVersions.$inferSelect;
type CadenceRow = typeof schema.scriptCadences.$inferSelect;

const cadences = schema.scriptCadences;
const structures = schema.scriptStructures;
const versions = schema.scriptStructureVersions;
const queue = schema.scriptStructureQueue;

const SkippedSchema = z.array(ScriptCadenceSkipSchema);

const NEVER_CHECKED: StoredCadence = {
  days: SCRIPT_CADENCE_DEFAULT_DAYS,
  outcome: null,
  skipped: [],
  checkedAt: null,
};

/** A row as the contract has it, parsed: written by this module only, but a row is still a boundary. */
const cadenceOf = (row: CadenceRow | undefined): StoredCadence =>
  row === undefined
    ? NEVER_CHECKED
    : {
        days: row.days,
        outcome: row.outcome === null ? null : ScriptCadenceOutcomeSchema.parse(row.outcome),
        skipped: SkippedSchema.parse(row.skipped),
        checkedAt: row.checkedAt,
      };

/** A version as the contract has it (the versions read here were all written after migration 0095). */
const toVersion = (row: VersionRow): ScriptStructureVersion =>
  ScriptStructureVersionSchema.parse({
    id: row.id,
    version: row.version,
    name: row.name,
    moment: row.moment,
    color: row.color,
    segments: row.segments,
    frozen: row.frozenAt !== null,
    updatedAt: row.updatedAt.toISOString(),
  });

/** The latest version of one structure. */
async function latestOf(tx: Transaction, structureId: string): Promise<VersionRow | undefined> {
  const [row] = await tx
    .select()
    .from(versions)
    .where(eq(versions.structureId, structureId))
    .orderBy(sql`${versions.version} desc`)
    .limit(1);
  return row;
}

/** One writer of a creator's queue at a time (the same lock as the owner's `setQueue`), until the transaction ends. */
const lockQueue = (tx: Transaction, creatorId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`scripts.queue:${creatorId}`}, 0))`);

/**
 * Her cadence (SC-02): the routes as the signed-in account, under her RLS and the team's scopes; the hourly job as the
 * admin role, which alone writes what it found.
 */
export function createDrizzleCadenceStore(db: Database, adminDb: Database): CadenceStore {
  const exists = async (tx: Transaction, creatorId: CreatorId): Promise<boolean> =>
    (
      await tx
        .select({ id: schema.creators.id })
        .from(schema.creators)
        .where(eq(schema.creators.id, creatorId))
    ).length > 0;

  return {
    // `creators` is out of RLS: only the owner and an active manager read a cadence, so anyone else gets the same 404
    // for a creator that exists and one that does not (recette SEC-06).
    read: (creatorId, userId) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if ((scope !== 'owner' && scope !== 'agency') || !(await exists(tx, creatorId))) return null;
        const [row] = await tx.select().from(cadences).where(eq(cadences.creatorId, creatorId));
        return cadenceOf(row);
      }),

    setDays: (creatorId, days, userId) =>
      withTenantMember(db, creatorId, userId, async (tx) => {
        if (!(await exists(tx, creatorId))) return null;
        const [row] = await tx
          .insert(cadences)
          .values({ creatorId, days, updatedBy: userId })
          .onConflictDoUpdate({
            target: cadences.creatorId,
            set: { days, updatedBy: userId, updatedAt: sql`now()` },
          })
          .returning();
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId,
          action: 'script_cadence.update',
          entity: 'script_cadence',
          entityId: creatorId,
          details: { days },
        });
        return cadenceOf(row);
      }),

    creators: () =>
      withAdmin(adminDb, async (tx) =>
        (
          await tx
            .select({ id: schema.creators.id, timeZone: schema.creators.timezone })
            .from(schema.creators)
            .orderBy(schema.creators.createdAt)
        ).map((row) => ({ id: CreatorIdSchema.parse(row.id), timeZone: row.timeZone })),
      ),

    days: (creatorId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({ days: cadences.days })
          .from(cadences)
          .where(eq(cadences.creatorId, creatorId));
        return row?.days ?? SCRIPT_CADENCE_DEFAULT_DAYS;
      }),

    queue: (creatorId) =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select()
          .from(queue)
          .where(eq(queue.creatorId, creatorId))
          .orderBy(queue.position);
        const entries: QueuedStructure[] = [];
        for (const row of rows) {
          const latest = await latestOf(tx, row.structureId);
          if (latest === undefined) throw new Error('queued structure without a version');
          entries.push({
            structureId: ScriptStructureIdSchema.parse(row.structureId),
            current: toVersion(latest),
          });
        }
        return entries;
      }),

    usable: (creatorId, structureId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select()
          .from(structures)
          .where(
            and(
              eq(structures.id, structureId),
              sql`${structures.archivedAt} is null`,
              sql`(${structures.reservedCreatorId} is null or ${structures.reservedCreatorId} = ${creatorId})`,
            ),
          );
        if (row === undefined) return null;
        const latest = await latestOf(tx, structureId);
        return latest === undefined ? null : { structureId, current: toVersion(latest) };
      }),

    freeze: (structureId) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx.select().from(structures).where(eq(structures.id, structureId)).for('update');
        if (row?.archivedAt !== null) return null;
        const latest = await latestOf(tx, structureId);
        if (latest === undefined) throw new Error('script structure without a version');
        if (latest.frozenAt !== null) return toVersion(latest);
        const [frozen] = await tx
          .update(versions)
          .set({ frozenAt: sql`now()` })
          .where(eq(versions.id, latest.id))
          .returning();
        if (frozen === undefined) throw new Error('script structure version not frozen');
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: null,
          action: 'script_structure.freeze',
          entity: 'script_structure',
          entityId: structureId,
          details: { version: frozen.version, by: 'scripts.ask_scripts' },
        });
        return toVersion(frozen);
      }),

    dequeue: (creatorId, structureId, askedAt) =>
      withAdmin(adminDb, async (tx) => {
        await lockQueue(tx, creatorId);
        const [gone] = await tx
          .delete(queue)
          .where(
            and(
              eq(queue.creatorId, creatorId),
              eq(queue.structureId, structureId),
              sql`${queue.createdAt} <= ${askedAt.toISOString()}::timestamptz`,
            ),
          )
          .returning({ position: queue.position });
        if (gone === undefined) return;
        // The positions after it move up, one row at a time in order: the primary key holds at every step.
        const after = await tx
          .select({ position: queue.position })
          .from(queue)
          .where(and(eq(queue.creatorId, creatorId), sql`${queue.position} > ${gone.position}`))
          .orderBy(queue.position);
        for (const row of after)
          await tx
            .update(queue)
            .set({ position: row.position - 1 })
            .where(and(eq(queue.creatorId, creatorId), eq(queue.position, row.position)));
      }),

    record: (creatorId, outcome, skipped, now) =>
      withAdmin(adminDb, async (tx) => {
        await tx
          .insert(cadences)
          .values({ creatorId, outcome, skipped: [...skipped], checkedAt: now })
          .onConflictDoUpdate({
            target: cadences.creatorId,
            set: { outcome, skipped: [...skipped], checkedAt: now, updatedAt: now },
          });
      }),
  };
}
