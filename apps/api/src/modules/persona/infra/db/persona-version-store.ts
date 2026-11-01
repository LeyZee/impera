import { createHash } from 'node:crypto';

import {
  AuditEntryIdSchema,
  newId,
  PersonaSchema,
  PersonaVersionIdSchema,
  type Persona,
  type PersonaVersionSummary,
} from '@nirvana/contracts';
import { and, eq, schema, sql, withTenant, type Database, type Transaction } from '@nirvana/db';

import { canonicalJson } from '../../domain/canonical';
import { PersonaVersionConflict, PersonaVersionNotFound } from '../../domain/errors';
import type { PersonaVersionStore } from '../../domain/versions';

/** What `source_path` says of a version saved from the dashboard rather than loaded from a YAML file. */
const FROM_DASHBOARD = 'dashboard';

/** Who stored a version loaded by `pnpm persona:load` (no signed-in user on the command line). */
const FROM_COMMAND = 'cli';

const columns = {
  id: schema.personaVersions.id,
  version: schema.personaVersions.version,
  contentHash: schema.personaVersions.contentHash,
  isActive: schema.personaVersions.isActive,
  createdAt: schema.personaVersions.createdAt,
};

interface SummaryRow {
  id: string;
  version: string;
  contentHash: string;
  isActive: boolean;
  createdAt: Date;
}

const toSummary = (row: SummaryRow): PersonaVersionSummary => ({
  id: PersonaVersionIdSchema.parse(row.id),
  version: row.version,
  contentHash: row.contentHash,
  isActive: row.isActive,
  createdAt: row.createdAt.toISOString(),
});

const newestFirst = sql`${schema.personaVersions.createdAt} desc, ${schema.personaVersions.id} desc`;

const summaries = (tx: Transaction): Promise<SummaryRow[]> =>
  tx.select(columns).from(schema.personaVersions).orderBy(newestFirst);

/** One save or load at a time per creator, so that two writers cannot both pass their checks. */
const lockCreator = (tx: Transaction, creatorId: string): Promise<unknown> =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`persona:${creatorId}`}))`);

const contentHash = (persona: unknown): string =>
  createHash('sha256').update(canonicalJson(persona)).digest('hex');

/** Postgres `unique_violation`: the (creator, version) pair already exists. */
const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Error &&
  [error, error.cause].some((e) => typeof e === 'object' && e !== null && 'code' in e && e.code === '23505');

/** One line of `audit_log`: identifiers and hashes only, never the content of a persona. */
const audit = (
  tx: Transaction,
  action: string,
  entityId: string,
  details: Record<string, string>,
  userId: string | null = null,
): Promise<unknown> =>
  tx.insert(schema.auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId,
    action,
    entity: 'persona_version',
    entityId,
    details,
  });

/**
 * Makes `row` her only active version, audited with who did it (null: the command line); an active one is left as
 * it is. The unique index allows one active version per creator: the previous one goes first.
 */
async function activateRow(
  tx: Transaction,
  creatorId: string,
  row: SummaryRow,
  userId: string | null,
): Promise<{ row: SummaryRow; activated: boolean }> {
  if (row.isActive) return { row, activated: false };
  await tx
    .update(schema.personaVersions)
    .set({ isActive: false })
    .where(and(eq(schema.personaVersions.isActive, true), eq(schema.personaVersions.creatorId, creatorId)));
  const [active] = await tx
    .update(schema.personaVersions)
    .set({ isActive: true, activatedAt: new Date() })
    .where(eq(schema.personaVersions.id, row.id))
    .returning(columns);
  if (active === undefined) throw new Error('persona version activation returned nothing');
  await audit(
    tx,
    'persona_version.activate',
    active.id,
    { creatorId, version: active.version, contentHash: active.contentHash },
    userId,
  );
  return { row: active, activated: true };
}

/**
 * `checkBeforeActivate` reads a stored version again before the screen activates it, and throws to refuse it: the
 * guards may have changed since it was saved (the sample replies, P5-01).
 */
export function createDrizzlePersonaVersionStore(
  db: Database,
  checkBeforeActivate?: (persona: Persona) => void,
): PersonaVersionStore {
  return {
    active(creatorId) {
      return withTenant(db, creatorId, async (tx) => {
        const [row] = await tx
          .select({
            id: schema.personaVersions.id,
            version: schema.personaVersions.version,
            content: schema.personaVersions.content,
            creatorName: schema.creators.displayName,
          })
          .from(schema.personaVersions)
          .innerJoin(schema.creators, eq(schema.creators.id, schema.personaVersions.creatorId))
          .where(
            and(eq(schema.personaVersions.creatorId, creatorId), eq(schema.personaVersions.isActive, true)),
          );
        if (row === undefined) return null;
        return {
          id: PersonaVersionIdSchema.parse(row.id),
          version: row.version,
          creatorName: row.creatorName,
          persona: PersonaSchema.parse(row.content),
        };
      });
    },

    overview(creatorId) {
      return withTenant(db, creatorId, async (tx) => {
        const rows = await summaries(tx);
        const newest = rows[0];
        if (newest === undefined) return { creatorId, latest: null, versions: [] };
        const [content] = await tx
          .select({ content: schema.personaVersions.content })
          .from(schema.personaVersions)
          .where(eq(schema.personaVersions.id, newest.id));
        return {
          creatorId,
          latest: { summary: toSummary(newest), persona: PersonaSchema.parse(content?.content) },
          versions: rows.map(toSummary),
        };
      });
    },

    async create(creatorId, body, userId) {
      const persona = PersonaSchema.parse(body.persona);
      const hash = contentHash(persona);
      const id = newId(PersonaVersionIdSchema);
      try {
        return await withTenant(db, creatorId, async (tx) => {
          await lockCreator(tx, creatorId);
          const [newest] = await summaries(tx);
          if ((newest?.contentHash ?? null) !== body.basedOn) throw new PersonaVersionConflict();
          const [row] = await tx
            .insert(schema.personaVersions)
            .values({
              id,
              creatorId,
              version: persona.meta.version,
              sourcePath: FROM_DASHBOARD,
              content: persona,
              contentHash: hash,
              isActive: false,
              createdBy: userId,
            })
            .returning(columns);
          await tx.insert(schema.auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId,
            action: 'persona_version.create',
            entity: 'persona_version',
            entityId: id,
            details: { creatorId, version: persona.meta.version, contentHash: hash },
          });
          if (row === undefined) throw new Error('persona version insert returned nothing');
          return toSummary(row);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new PersonaVersionConflict();
        throw error;
      }
    },

    async load(creatorId, input, { sourcePath, activate }) {
      const persona = PersonaSchema.parse(input);
      const hash = contentHash(persona);
      const { version } = persona.meta;
      return withTenant(db, creatorId, async (tx) => {
        await lockCreator(tx, creatorId);
        const [existing] = await tx
          .select(columns)
          .from(schema.personaVersions)
          .where(eq(schema.personaVersions.version, version));
        if (existing !== undefined && existing.contentHash !== hash) throw new PersonaVersionConflict();
        let row = existing;
        if (row === undefined) {
          const id = newId(PersonaVersionIdSchema);
          [row] = await tx
            .insert(schema.personaVersions)
            .values({
              id,
              creatorId,
              version,
              sourcePath,
              content: persona,
              contentHash: hash,
              createdBy: FROM_COMMAND,
            })
            .returning(columns);
          if (row === undefined) throw new Error('persona version insert returned nothing');
          await audit(tx, 'persona_version.create', row.id, {
            creatorId,
            version,
            contentHash: hash,
            sourcePath,
          });
        }
        const result = activate ? await activateRow(tx, creatorId, row, null) : { row, activated: false };
        return {
          version: toSummary(result.row),
          created: existing === undefined,
          activated: result.activated,
        };
      });
    },

    activate(creatorId, versionId, expectedActive, userId) {
      return withTenant(db, creatorId, async (tx) => {
        await lockCreator(tx, creatorId);
        const rows = await summaries(tx);
        const row = rows.find((r) => r.id === versionId);
        if (row === undefined) throw new PersonaVersionNotFound();
        // A screen left open activates only over the active version it read: never undo an activation made since.
        if ((rows.find((r) => r.isActive)?.id ?? null) !== expectedActive) throw new PersonaVersionConflict();
        if (!row.isActive && checkBeforeActivate !== undefined) {
          const [stored] = await tx
            .select({ content: schema.personaVersions.content })
            .from(schema.personaVersions)
            .where(eq(schema.personaVersions.id, row.id));
          checkBeforeActivate(PersonaSchema.parse(stored?.content));
        }
        return toSummary((await activateRow(tx, creatorId, row, userId)).row);
      });
    },
  };
}
