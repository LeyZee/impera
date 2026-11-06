import {
  AuditEntryIdSchema,
  newId,
  PERSONA_CORRECTIONS_OPEN_MAX,
  PersonaCorrectionIdSchema,
  PersonaCorrectionSectionSchema,
  PersonaCorrectionStateSchema,
  type PersonaCorrection,
} from '@impera/contracts';
import {
  and,
  eq,
  schema,
  sql,
  withCreatorAccount,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';

import type { PersonaCorrectionStore } from '../../domain/corrections';
import {
  PersonaCorrectionConflict,
  PersonaCorrectionNotFound,
  PersonaCorrectionsLimited,
} from '../../domain/errors';

const t = schema.personaCorrections;

const columns = {
  id: t.id,
  section: t.section,
  text: t.text,
  state: t.state,
  createdAt: t.createdAt,
  doneAt: t.doneAt,
};

interface Row {
  id: string;
  section: string;
  text: string;
  state: string;
  createdAt: Date;
  doneAt: Date | null;
}

const toCorrection = (row: Row): PersonaCorrection => ({
  id: PersonaCorrectionIdSchema.parse(row.id),
  section: PersonaCorrectionSectionSchema.parse(row.section),
  text: row.text,
  state: PersonaCorrectionStateSchema.parse(row.state),
  createdAt: row.createdAt.toISOString(),
  doneAt: row.doneAt === null ? null : row.doneAt.toISOString(),
});

/** Every one the transaction's policies show (hers, in her creator), newest first. */
const newestFirst = async (tx: Transaction): Promise<PersonaCorrection[]> =>
  (
    await tx
      .select(columns)
      .from(t)
      .orderBy(sql`${t.createdAt} desc, ${t.id} desc`)
  ).map(toCorrection);

const byId = async (tx: Transaction, id: string): Promise<Row | undefined> =>
  (await tx.select(columns).from(t).where(eq(t.id, id)))[0];

/** Her corrections (recette CREA-01 b), under the policies of `persona_corrections` (migration 0126). */
export function createDrizzlePersonaCorrectionStore(db: Database): PersonaCorrectionStore {
  return {
    mine: (userId) => withCreatorAccount(db, userId, newestFirst),

    propose: (userId, body) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        // One proposal at a time per creator: two tabs cannot both pass the count, and the same id sent twice at once
        // reads, the second time, the correction the first stored.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`persona-corrections:${creatorId}`}))`);
        const sent = await byId(tx, body.id);
        if (sent !== undefined) {
          if (sent.section !== body.section || sent.text !== body.text) throw new PersonaCorrectionConflict();
          return toCorrection(sent);
        }
        const [open] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(t)
          .where(eq(t.state, 'open'));
        if ((open?.count ?? 0) >= PERSONA_CORRECTIONS_OPEN_MAX) throw new PersonaCorrectionsLimited();
        const [stored] = await tx
          .insert(t)
          .values({ id: body.id, creatorId, section: body.section, text: body.text, createdBy: userId })
          // The same id from another creator: her policies hide it, the key does not.
          .onConflictDoNothing({ target: t.id })
          .returning(columns);
        if (stored === undefined) throw new PersonaCorrectionConflict();
        return toCorrection(stored);
      }),

    list: (creatorId, userId) => withTenantMember(db, creatorId, userId, newestFirst),

    markDone: (creatorId, correctionId, userId) =>
      withTenantMember(db, creatorId, userId, async (tx) => {
        const [done] = await tx
          .update(t)
          .set({ state: 'done', doneBy: userId, doneAt: sql`now()` })
          .where(and(eq(t.id, correctionId), eq(t.state, 'open')))
          .returning(columns);
        if (done !== undefined) {
          // Like every gesture on her persona, with who made it; never the words she wrote.
          await tx.insert(schema.auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId,
            action: 'persona_correction.done',
            entity: 'persona_correction',
            entityId: done.id,
            details: { creatorId, section: done.section },
          });
          return toCorrection(done);
        }
        const already = await byId(tx, correctionId);
        if (already === undefined) throw new PersonaCorrectionNotFound();
        return toCorrection(already);
      }),
  };
}
