import {
  AuditEntryIdSchema,
  kindOfMime,
  newId,
  ShotMomentSchema,
  slotLengths,
  type ContentDrop,
} from '@impera/contracts';
import {
  and,
  eq,
  schema,
  sql,
  withAdmin,
  withCreatorAccount,
  type Database,
  type Transaction,
} from '@impera/db';

import {
  ContentDropFileSettled,
  ContentDropIdConflict,
  ContentDropNotFound,
  ContentDropRequestUnprocessable,
  ContentDropScriptUnprocessable,
  ContentDropSlotsUnprocessable,
} from '../../domain/errors';
import type { ScriptDropStore, StartedScript } from '../../domain/ports';
import { requiredSlotsMissing } from '../../domain/script-drops';

import { enqueueSummary } from './script-summary-store';
import { follow, pgErrorOf, readDrop, readRequest, viewOf } from './store';

const { contentDropFiles, contentDrops } = schema;

/** The frozen version her drop shoots and the moment it is shot at: its request's (SC-02 lot a, SC-03 c2). */
async function versionOf(tx: Transaction, requestId: string | null): Promise<Omit<StartedScript, 'drop'>> {
  if (requestId === null) throw new ContentDropScriptUnprocessable();
  const request = await readRequest(tx, requestId);
  if (request?.structureVersionId == null) throw new ContentDropScriptUnprocessable();
  return { versionId: request.structureVersionId, moment: ShotMomentSchema.nullable().parse(request.moment) };
}

/** Her script drop, as her account reads it; refused when it is not a script. */
async function startedIn(tx: Transaction, dropId: string): Promise<StartedScript> {
  const row = await readDrop(tx, dropId);
  if (row === undefined) throw new ContentDropNotFound();
  if (row.category !== 'script') throw new ContentDropScriptUnprocessable();
  return { drop: await viewOf(tx, row), ...(await versionOf(tx, row.requestId)) };
}

/**
 * Her script filled slot by slot (SC-02 lot b, ADR 0056 § 4), in her own account (`withCreatorAccount`): begun empty
 * from her request, each slot's file declared as she chooses it, a file replaced keeping its place. Sending it moves
 * the drop on as the admin role, as the receipt does: no policy lets her move a state but « withdrawn ».
 */
export function createDrizzleScriptDropStore(db: Database, adminDb: Database): ScriptDropStore {
  return {
    start: (userId, body) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const known = await readDrop(tx, body.id);
        if (known !== undefined) {
          if (known.category !== 'script' || known.requestId !== body.requestId)
            throw new ContentDropIdConflict();
          return startedIn(tx, body.id);
        }
        const request = await readRequest(tx, body.requestId);
        if (request === undefined) throw new ContentDropRequestUnprocessable('Cette demande n’existe pas');
        if (request.category !== 'script')
          throw new ContentDropRequestUnprocessable('Cette demande attend une autre catégorie');
        if (request.structureVersionId === null) throw new ContentDropScriptUnprocessable();
        // Locked, so that her refusal and her script never cross.
        if (request.state !== 'open' || (await readRequest(tx, body.requestId, true)) === undefined)
          throw new ContentDropRequestUnprocessable();
        try {
          await tx.insert(contentDrops).values({
            id: body.id,
            creatorId,
            category: 'script',
            state: 'filling',
            requestId: body.requestId,
            createdBy: userId,
          });
        } catch (error) {
          const failure = pgErrorOf(error);
          if (failure?.code !== '23505') throw error;
          if (failure.constraint === 'content_drops_request_live_unique')
            throw new ContentDropRequestUnprocessable();
          throw new ContentDropIdConflict();
        }
        return startedIn(tx, body.id);
      }),

    read: (userId, dropId) => withCreatorAccount(db, userId, (tx) => startedIn(tx, dropId)),

    fill: (userId, dropId, slot, file, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const seen = await readDrop(tx, dropId);
        if (seen === undefined) throw new ContentDropNotFound();
        if (seen.category !== 'script') throw new ContentDropScriptUnprocessable();
        // Locked through her withdrawal policy, which sees a drop while she fills it: two slots, one at a time.
        const row = seen.state === 'filling' ? await readDrop(tx, dropId, true) : undefined;
        const [live] = await tx
          .select()
          .from(contentDropFiles)
          .where(
            and(
              eq(contentDropFiles.dropId, dropId),
              eq(contentDropFiles.slotKey, slot.key),
              sql`${contentDropFiles.replacedAt} is null`,
            ),
          );
        // Her phone replaying the same choice: the drop as it is, sent or not.
        const replayed = live?.id === file.id ? live : null;
        if (replayed !== null) {
          if (replayed.mime !== file.mime || replayed.bytes !== file.bytes) throw new ContentDropIdConflict();
          return viewOf(tx, seen);
        }
        if (row?.state !== 'filling') throw new ContentDropFileSettled();
        const lengths = slotLengths(slot.slot);
        if (live !== undefined)
          await tx
            .update(contentDropFiles)
            .set({ replacedAt: now, updatedAt: now })
            .where(eq(contentDropFiles.id, live.id));
        try {
          await tx.insert(contentDropFiles).values({
            id: file.id,
            creatorId,
            dropId,
            position: slot.position,
            kind: kindOfMime(file.mime),
            mime: file.mime,
            bytes: file.bytes,
            slotKey: slot.key,
            ...(lengths ?? {}),
          });
        } catch (error) {
          if (pgErrorOf(error)?.code === '23505') throw new ContentDropIdConflict();
          throw error;
        }
        return viewOf(tx, row);
      }),

    submit: (userId, dropId, slots, now, correlationId) =>
      withCreatorAccount(db, userId, async (tx) => {
        const seen = await readDrop(tx, dropId);
        if (seen === undefined) throw new ContentDropNotFound();
        if (seen.category !== 'script') throw new ContentDropScriptUnprocessable();
        return seen.creatorId;
      }).then((creatorId) =>
        withAdmin(adminDb, async (tx): Promise<ContentDrop> => {
          const row = await readDrop(tx, dropId, true);
          if (row?.creatorId !== creatorId) throw new ContentDropNotFound();
          // Sent already: her phone replaying the tap.
          if (row.state !== 'filling') return viewOf(tx, row);
          const drop = await viewOf(tx, row);
          const missing = requiredSlotsMissing(slots, drop.files);
          if (missing.length > 0) throw new ContentDropSlotsUnprocessable(missing);
          const scriptNumber = await nextScriptNumber(tx, creatorId);
          await tx
            .update(contentDrops)
            .set({ state: 'uploading', scriptNumber, updatedAt: now })
            .where(eq(contentDrops.id, dropId));
          await tx.insert(schema.auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId,
            action: 'content_drop.submit_script',
            entity: 'content_drop',
            entityId: dropId,
            details: { files: drop.files.length, scriptNumber },
          });
          await follow(tx, { ...row, state: 'uploading' }, now, correlationId);
          // Told once its media are described (ADR 0083 § 6): the job waits for the last description.
          await enqueueSummary(tx, { creatorId, dropId, correlationId }, null);
          const after = await readDrop(tx, dropId);
          if (after === undefined) throw new ContentDropNotFound();
          return viewOf(tx, after);
        }),
      ),
  };
}

/**
 * Her next script's number (SC-03, ADR 0056 § 5): one more than her last, 1 for her first. A lock of the transaction
 * on her numbering first, so two scripts sent at once take 2 and 3, never 2 twice; an advisory lock, never her
 * `creators` row, whose lock would hold every insert that names her (Bilan's review of #602).
 * `content_drops_script_number_unique` stays the last guard. Given once, when she sends it: a script withdrawn
 * afterwards keeps its number.
 */
async function nextScriptNumber(tx: Transaction, creatorId: string): Promise<number> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('content_drops.script_number:' || ${creatorId}))`,
  );
  const [row] = await tx
    .select({ last: sql<number | null>`max(${contentDrops.scriptNumber})::int` })
    .from(contentDrops)
    .where(eq(contentDrops.creatorId, creatorId));
  return (row?.last ?? 0) + 1;
}
