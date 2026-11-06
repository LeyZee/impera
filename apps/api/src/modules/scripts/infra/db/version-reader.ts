import {
  AuditEntryIdSchema,
  newId,
  ScriptStructureVersionSchema,
  type ScriptStructureVersion,
} from '@impera/contracts';
import { eq, schema, sql, withAdmin, type Database } from '@impera/db';

const versions = schema.scriptStructureVersions;
const structures = schema.scriptStructures;

/**
 * A frozen version, read as the admin role (SC-02 lot b): the one her script drop shoots, which she reads although the
 * library is the team's. Only frozen: a version still being written is never shown to a creator.
 */
export function createFrozenVersionReader(
  adminDb: Database,
): (versionId: string) => Promise<ScriptStructureVersion | null> {
  return (versionId) =>
    withAdmin(adminDb, async (tx) => {
      const [row] = await tx
        .select()
        .from(versions)
        .where(sql`${versions.id} = ${versionId} and ${versions.frozenAt} is not null`);
      if (row === undefined) return null;
      return ScriptStructureVersionSchema.parse({
        id: row.id,
        version: row.version,
        name: row.name,
        moment: row.moment,
        color: row.color,
        segments: row.segments,
        frozen: true,
        updatedAt: row.updatedAt.toISOString(),
      });
    });
}

/**
 * The latest version of a structure frozen for a script the agency asks by hand (SC-02 lot b), as the admin role: a
 * manager may ask a script but never writes the library, whose policies are the owner's. The caller has checked the
 * structure usable for her under the team's policies; this one refuses an archived or unknown structure (`null`). Who
 * asked is audited.
 */
export function createRequestFreezer(
  adminDb: Database,
): (structureId: string, userId: string) => Promise<string | null> {
  return (structureId, userId) =>
    withAdmin(adminDb, async (tx) => {
      const [row] = await tx.select().from(structures).where(eq(structures.id, structureId)).for('update');
      if (row?.archivedAt !== null) return null;
      const [latest] = await tx
        .select()
        .from(versions)
        .where(eq(versions.structureId, structureId))
        .orderBy(sql`${versions.version} desc`)
        .limit(1);
      if (latest === undefined) return null;
      if (latest.frozenAt !== null) return latest.id;
      await tx
        .update(versions)
        .set({ frozenAt: sql`now()` })
        .where(eq(versions.id, latest.id));
      await tx.insert(schema.auditLog).values({
        id: newId(AuditEntryIdSchema),
        userId,
        action: 'script_structure.freeze',
        entity: 'script_structure',
        entityId: structureId,
        details: { version: latest.version, by: 'content_request' },
      });
      return latest.id;
    });
}
