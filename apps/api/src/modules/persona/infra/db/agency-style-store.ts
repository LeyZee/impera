import {
  AgencyStyleIdSchema,
  AuditEntryIdSchema,
  newId,
  VoiceFormSettingsSchema,
  type AgencyStyleVersion,
} from '@impera/contracts';
import { eq, schema, sql, withAdmin, withMember, type Database, type Transaction } from '@impera/db';

import { AgencyStyleConflict, AgencyStyleNotFound, type AgencyStyleStore } from '../../domain/agency-style';

const newestFirst = sql`${schema.agencyStyles.version} desc`;

/** The latest versions the screen lists. */
const LISTED = 20;

const columns = {
  id: schema.agencyStyles.id,
  version: schema.agencyStyles.version,
  privateStyle: schema.agencyStyles.privateStyle,
  publicStyle: schema.agencyStyles.publicStyle,
  form: schema.agencyStyles.form,
  isActive: schema.agencyStyles.isActive,
  createdAt: schema.agencyStyles.createdAt,
  activatedAt: schema.agencyStyles.activatedAt,
};

interface Row {
  id: string;
  version: number;
  privateStyle: string;
  publicStyle: string;
  form: unknown;
  isActive: boolean;
  createdAt: Date;
  activatedAt: Date | null;
}

/** A stored row, its form read through its schema: one that no longer reads counts as no rule set. */
const toVersion = (row: Row): AgencyStyleVersion => {
  const form = VoiceFormSettingsSchema.safeParse(row.form);
  return {
    id: AgencyStyleIdSchema.parse(row.id),
    version: row.version,
    privateStyle: row.privateStyle,
    publicStyle: row.publicStyle,
    form: form.success ? form.data : {},
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
  };
};

/** One save or activation at a time, so that two writers never take the same number or both activate. */
const lock = (tx: Transaction): Promise<unknown> =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext('agency_style'))`);

/** One line of `audit_log`: the version and its number, never its texts. */
const audit = (tx: Transaction, action: string, row: Row, userId: string): Promise<unknown> =>
  tx.insert(schema.auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId,
    action,
    entity: 'agency_style',
    entityId: row.id,
    details: { version: String(row.version) },
  });

/**
 * The base style (ADR 0171): the owner's writes on the app's connection under his own policies (`withMember`), the
 * agent's read on the service connection (`activeUnscoped`).
 */
export function createDrizzleAgencyStyleStore(db: Database, adminDb: Database): AgencyStyleStore {
  return {
    overview: (userId) =>
      withMember(db, userId, async (tx) => {
        const rows = await tx.select(columns).from(schema.agencyStyles).orderBy(newestFirst).limit(LISTED);
        const [active] = await tx
          .select(columns)
          .from(schema.agencyStyles)
          .where(eq(schema.agencyStyles.isActive, true));
        return { active: active === undefined ? null : toVersion(active), versions: rows.map(toVersion) };
      }),

    save: (content, userId) =>
      withMember(db, userId, async (tx) => {
        await lock(tx);
        const [last] = await tx
          .select({ version: schema.agencyStyles.version })
          .from(schema.agencyStyles)
          .orderBy(newestFirst)
          .limit(1);
        const [row] = await tx
          .insert(schema.agencyStyles)
          .values({
            id: newId(AgencyStyleIdSchema),
            version: (last?.version ?? 0) + 1,
            privateStyle: content.privateStyle,
            publicStyle: content.publicStyle,
            form: content.form,
            createdBy: userId,
          })
          .returning(columns);
        if (row === undefined) throw new Error('agency style insert returned nothing');
        await audit(tx, 'agency_style.create', row, userId);
        return toVersion(row);
      }),

    activate: (versionId, expectedActive, userId) =>
      withMember(db, userId, async (tx) => {
        await lock(tx);
        const [row] = await tx
          .select(columns)
          .from(schema.agencyStyles)
          .where(eq(schema.agencyStyles.id, versionId));
        if (row === undefined) throw new AgencyStyleNotFound();
        const [current] = await tx
          .select({ id: schema.agencyStyles.id })
          .from(schema.agencyStyles)
          .where(eq(schema.agencyStyles.isActive, true));
        // A screen left open activates only over the active version it read: never undo an activation made since.
        if ((current?.id ?? null) !== expectedActive) throw new AgencyStyleConflict();
        if (row.isActive) return toVersion(row);
        await tx
          .update(schema.agencyStyles)
          .set({ isActive: false })
          .where(eq(schema.agencyStyles.isActive, true));
        const [active] = await tx
          .update(schema.agencyStyles)
          .set({ isActive: true, activatedBy: userId, activatedAt: new Date() })
          .where(eq(schema.agencyStyles.id, row.id))
          .returning(columns);
        if (active === undefined) throw new Error('agency style activation returned nothing');
        await audit(tx, 'agency_style.activate', active, userId);
        return toVersion(active);
      }),

    activeUnscoped: () =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select(columns)
          .from(schema.agencyStyles)
          .where(eq(schema.agencyStyles.isActive, true));
        return row === undefined ? null : toVersion(row);
      }),
  };
}
