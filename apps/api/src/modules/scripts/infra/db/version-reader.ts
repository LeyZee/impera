import { ScriptStructureVersionSchema, type ScriptStructureVersion } from '@impera/contracts';
import { schema, sql, withAdmin, type Database } from '@impera/db';

const versions = schema.scriptStructureVersions;

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
