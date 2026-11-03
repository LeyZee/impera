import {
  AuditEntryIdSchema,
  ContentDropFileIdSchema,
  ContentDropSchema,
  ContentRequestSchema,
  DropMimeSchema,
  DropStateSchema,
  kindOfMime,
  newId,
  type ContentDrop,
  type ContentRequest,
  type CreateContentDropBody,
  type CreateContentRequestBody,
  type CreatorContent,
  type DropCategory,
} from '@impera/contracts';
import {
  and,
  eq,
  inArray,
  schema,
  sql,
  withCreatorAccount,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';

import { dropRefusals, mayWithdraw, needsRequest } from '../../domain/drops';
import {
  ContentDropFormatUnprocessable,
  ContentDropForbidden,
  ContentDropIdConflict,
  ContentDropNotFound,
  ContentDropRequestUnprocessable,
  ContentDropScriptUnprocessable,
  ContentDropSettled,
  ContentRequestClosed,
  ContentRequestIdConflict,
  ContentRequestNotFound,
} from '../../domain/errors';
import type { AgencyContentStore, CreatorContentStore } from '../../domain/ports';

const { auditLog, contentDropFiles, contentDrops, contentRequests } = schema;

type DropRow = typeof contentDrops.$inferSelect;
type FileRow = typeof contentDropFiles.$inferSelect;
type RequestRow = typeof contentRequests.$inferSelect;

/** How many of her latest drops a read returns: her screen shows the recent ones, the rest stays in the base. */
const DROPS_READ = 100;

/** The Postgres error behind a failed query (Drizzle wraps it as `cause`). */
function pgErrorOf(error: unknown): { code: string; constraint: string | null } | null {
  for (let current = error; typeof current === 'object' && current !== null;) {
    if ('code' in current && typeof current.code === 'string') {
      const constraint =
        'constraint' in current && typeof current.constraint === 'string' ? current.constraint : null;
      return { code: current.code, constraint };
    }
    current = 'cause' in current ? current.cause : null;
  }
  return null;
}

const readsTeam = (scope: string): boolean => scope === 'owner' || scope === 'agency';

function dropOf(row: DropRow, files: readonly FileRow[]): ContentDrop {
  return ContentDropSchema.parse({
    id: row.id,
    category: row.category,
    correctedFrom: row.correctedFrom,
    sentence: row.sentence,
    state: row.state,
    blockedReason: row.blockedReason,
    requestId: row.requestId,
    files: files
      .filter((file) => file.dropId === row.id)
      .sort((a, b) => a.position - b.position)
      .map((file) => ({
        id: file.id,
        position: file.position,
        kind: file.kind,
        mime: file.mime,
        bytes: file.bytes,
        state: file.state,
        refusal: file.refusal,
      })),
    createdAt: row.createdAt.toISOString(),
  });
}

function requestOf(row: RequestRow, dropId: string | null): ContentRequest {
  return ContentRequestSchema.parse({
    id: row.id,
    category: row.category,
    dueOn: row.dueOn,
    reason: row.reason,
    structureId: row.structureId,
    origin: row.origin,
    state: row.state,
    refusalReason: row.refusalReason,
    dropId,
    createdAt: row.createdAt.toISOString(),
  });
}

async function filesOf(tx: Transaction, dropIds: readonly string[]): Promise<FileRow[]> {
  if (dropIds.length === 0) return [];
  return tx
    .select()
    .from(contentDropFiles)
    .where(inArray(contentDropFiles.dropId, [...dropIds]));
}

async function readDrop(tx: Transaction, dropId: string, lock = false): Promise<DropRow | undefined> {
  const query = tx.select().from(contentDrops).where(eq(contentDrops.id, dropId));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

/**
 * A request as the reader sees it; locked, through the update policy too, which hides a request the reader may no
 * longer change: read it unlocked first to tell « not there » from « closed ».
 */
async function readRequest(
  tx: Transaction,
  requestId: string,
  lock = false,
): Promise<RequestRow | undefined> {
  const query = tx.select().from(contentRequests).where(eq(contentRequests.id, requestId));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

async function viewOf(tx: Transaction, row: DropRow): Promise<ContentDrop> {
  return dropOf(row, await filesOf(tx, [row.id]));
}

/**
 * Her requests (oldest due first; `cancelled` only for the agency) and her latest drops not withdrawn, newest first.
 * What the policies show the reader, nothing more: her account or the team inside her.
 */
async function contentIn(tx: Transaction, forCreator: boolean): Promise<CreatorContent> {
  const drops = await tx
    .select()
    .from(contentDrops)
    .where(sql`${contentDrops.state} <> 'withdrawn'`)
    .orderBy(sql`${contentDrops.createdAt} desc`)
    .limit(DROPS_READ);
  const requests = await tx
    .select()
    .from(contentRequests)
    .where(forCreator ? sql`${contentRequests.state} <> 'cancelled'` : sql`true`)
    .orderBy(contentRequests.dueOn, contentRequests.createdAt);
  // The drop that answers each request, wherever it falls in the latest ones.
  const answers = await tx
    .select({ id: contentDrops.id, requestId: contentDrops.requestId })
    .from(contentDrops)
    .where(sql`${contentDrops.requestId} is not null and ${contentDrops.state} <> 'withdrawn'`);
  const answerOf = new Map(
    answers.flatMap((row) => (row.requestId === null ? [] : [[row.requestId, row.id]])),
  );
  const files = await filesOf(
    tx,
    drops.map((row) => row.id),
  );
  return {
    requests: requests.map((row) => requestOf(row, answerOf.get(row.id) ?? null)),
    drops: drops.map((row) => dropOf(row, files)),
  };
}

/** The same drop as the one asked for: a replay of her phone, which answers it. */
function sameDrop(stored: ContentDrop, body: CreateContentDropBody): boolean {
  return (
    (stored.correctedFrom ?? stored.category) === body.category &&
    stored.sentence === body.sentence &&
    stored.requestId === body.requestId &&
    stored.files.length === body.files.length &&
    stored.files.every((file, index) => {
      const asked = body.files[index];
      return asked?.id === file.id && asked.mime === file.mime && asked.bytes === file.bytes;
    })
  );
}

/**
 * A drop and its declared files, by her or by the agency for her (ADR 0044 § 1): its format checked first, a script
 * only from her open request of that category, a request answered once. A replay of the same drop answers it.
 */
async function dropIn(
  tx: Transaction,
  creatorId: string,
  userId: string,
  body: CreateContentDropBody,
): Promise<ContentDrop> {
  const known = await readDrop(tx, body.id);
  if (known !== undefined) {
    const stored = await viewOf(tx, known);
    if (!sameDrop(stored, body)) throw new ContentDropIdConflict();
    return stored;
  }
  const refusals = dropRefusals(body);
  if (refusals.length > 0) throw new ContentDropFormatUnprocessable(refusals);
  if (needsRequest(body.category) && body.requestId === null) throw new ContentDropScriptUnprocessable();
  if (body.requestId !== null) {
    const request = await readRequest(tx, body.requestId);
    if (request === undefined) throw new ContentDropRequestUnprocessable('Cette demande n’existe pas');
    if (request.category !== body.category)
      throw new ContentDropRequestUnprocessable('Cette demande attend une autre catégorie');
    // Locked, so that her refusal and her drop never cross: the one that waits finds the other done.
    if (request.state !== 'open' || (await readRequest(tx, body.requestId, true)) === undefined)
      throw new ContentDropRequestUnprocessable();
  }
  try {
    await tx.insert(contentDrops).values({
      id: body.id,
      creatorId,
      category: body.category,
      sentence: body.sentence,
      requestId: body.requestId,
      createdBy: userId,
    });
    await tx.insert(contentDropFiles).values(
      body.files.map((file, position) => ({
        id: file.id,
        creatorId,
        dropId: body.id,
        position,
        kind: kindOfMime(file.mime),
        mime: file.mime,
        bytes: file.bytes,
      })),
    );
  } catch (error) {
    const failure = pgErrorOf(error);
    if (failure?.code !== '23505') throw error;
    if (failure.constraint === 'content_drops_request_live_unique')
      throw new ContentDropRequestUnprocessable();
    // An id another creator's drop or file holds, which this reader does not see.
    throw new ContentDropIdConflict();
  }
  const row = await readDrop(tx, body.id);
  if (row === undefined) throw new ContentDropNotFound();
  return viewOf(tx, row);
}

async function withdrawIn(
  tx: Transaction,
  userId: string,
  dropId: string,
  by: 'creator' | 'agency',
  now: Date,
): Promise<void> {
  const seen = await readDrop(tx, dropId);
  if (seen === undefined) throw new ContentDropNotFound();
  // Withdrawing twice is no error: her phone may replay it.
  if (seen.state === 'withdrawn') return;
  if (!mayWithdraw(DropStateSchema.parse(seen.state), by)) throw new ContentDropSettled();
  // Locked through the update policy, which hides a drop the job scheduled meanwhile.
  const row = await readDrop(tx, dropId, true);
  if (row === undefined || !mayWithdraw(DropStateSchema.parse(row.state), by)) throw new ContentDropSettled();
  await tx
    .update(contentDrops)
    .set({ state: 'withdrawn', withdrawnAt: now, withdrawnBy: userId, updatedAt: now })
    .where(eq(contentDrops.id, dropId));
  await tx.insert(auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId,
    action: 'content_drop.withdraw',
    entity: 'content_drop',
    entityId: dropId,
    details: { by },
  });
}

export function createDrizzleCreatorContentStore(db: Database): CreatorContentStore {
  return {
    content: (userId) => withCreatorAccount(db, userId, (tx) => contentIn(tx, true)),
    drop: (userId, body) =>
      withCreatorAccount(db, userId, (tx, creatorId) => dropIn(tx, creatorId, userId, body)),
    withdraw: (userId, dropId, now) =>
      withCreatorAccount(db, userId, (tx) => withdrawIn(tx, userId, dropId, 'creator', now)),
    refuse: (userId, requestId, reason, now) =>
      withCreatorAccount(db, userId, async (tx) => {
        const request = await readRequest(tx, requestId);
        if (request === undefined) throw new ContentRequestNotFound();
        // The same refusal replayed is no error; any other closing is.
        if (request.state === 'refused') return;
        if (request.state !== 'open' || (await readRequest(tx, requestId, true)) === undefined)
          throw new ContentRequestClosed();
        const [answer] = await tx
          .select({ id: contentDrops.id })
          .from(contentDrops)
          .where(and(eq(contentDrops.requestId, requestId), sql`${contentDrops.state} <> 'withdrawn'`));
        if (answer !== undefined) throw new ContentRequestClosed();
        await tx
          .update(contentRequests)
          .set({ state: 'refused', refusalReason: reason, decidedAt: now, updatedAt: now })
          .where(eq(contentRequests.id, requestId));
      }),
  };
}

/** `withTenantMember` for the owner and an active manager; a chatter is refused before any read. */
export function createDrizzleAgencyContentStore(db: Database): AgencyContentStore {
  const asTeam = <T>(creatorId: string, userId: string, run: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenantMember(db, creatorId, userId, async (tx, scope) => {
      if (!readsTeam(scope)) throw new ContentDropForbidden();
      const [creator] = await tx
        .select({ id: schema.creators.id })
        .from(schema.creators)
        .where(eq(schema.creators.id, creatorId));
      if (creator === undefined) throw new ContentDropForbidden();
      return run(tx);
    });

  return {
    content: (creatorId, userId) => asTeam(creatorId, userId, (tx) => contentIn(tx, false)),
    drop: (creatorId, userId, body) => asTeam(creatorId, userId, (tx) => dropIn(tx, creatorId, userId, body)),
    withdraw: (creatorId, userId, dropId, now) =>
      asTeam(creatorId, userId, (tx) => withdrawIn(tx, userId, dropId, 'agency', now)),
    correct: (creatorId, userId, dropId, category: DropCategory, now) =>
      asTeam(creatorId, userId, async (tx) => {
        const seen = await readDrop(tx, dropId);
        if (seen === undefined || seen.state === 'withdrawn') throw new ContentDropNotFound();
        if (seen.state === 'published') throw new ContentDropSettled();
        const row = await readDrop(tx, dropId, true);
        if (row === undefined) throw new ContentDropSettled();
        if (row.category === category) return viewOf(tx, row);
        // A drop that answers a request is of the request's category.
        if (row.requestId !== null)
          throw new ContentDropRequestUnprocessable(
            'Ce dépôt répond à une demande : il en garde la catégorie',
          );
        // Her own choice is kept; a correction back to it clears the mark.
        const herChoice = row.correctedFrom ?? row.category;
        const back = herChoice === category;
        if (needsRequest(category)) throw new ContentDropScriptUnprocessable();
        const files = await filesOf(tx, [row.id]);
        const refusals = dropRefusals({
          category,
          files: files.map((file) => ({
            id: ContentDropFileIdSchema.parse(file.id),
            mime: DropMimeSchema.parse(file.mime),
            bytes: file.bytes,
          })),
        });
        if (refusals.length > 0) throw new ContentDropFormatUnprocessable(refusals);
        await tx
          .update(contentDrops)
          .set({
            category,
            correctedFrom: back ? null : herChoice,
            correctedBy: back ? null : userId,
            correctedAt: back ? null : now,
            updatedAt: now,
          })
          .where(eq(contentDrops.id, dropId));
        await tx.insert(auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId,
          action: 'content_drop.correct_category',
          entity: 'content_drop',
          entityId: dropId,
          details: { from: row.category, to: category },
        });
        const updated = await readDrop(tx, dropId);
        if (updated === undefined) throw new ContentDropNotFound();
        return viewOf(tx, updated);
      }),
    ask: (creatorId, userId, body: CreateContentRequestBody) =>
      asTeam(creatorId, userId, async (tx) => {
        const [known] = await tx.select().from(contentRequests).where(eq(contentRequests.id, body.id));
        if (known !== undefined) {
          const same =
            known.category === body.category &&
            known.dueOn === body.dueOn &&
            known.reason === body.reason &&
            known.structureId === body.structureId;
          if (!same) throw new ContentRequestIdConflict();
          return requestOf(known, null);
        }
        try {
          await tx.insert(contentRequests).values({
            id: body.id,
            creatorId,
            category: body.category,
            dueOn: body.dueOn,
            reason: body.reason,
            structureId: body.structureId,
            origin: 'agency',
            createdBy: userId,
          });
        } catch (error) {
          const failure = pgErrorOf(error);
          if (failure?.code === '23505') throw new ContentRequestIdConflict();
          // 23503: a structure that does not exist.
          if (failure?.code === '23503') throw new ContentRequestNotFound();
          throw error;
        }
        const [row] = await tx.select().from(contentRequests).where(eq(contentRequests.id, body.id));
        if (row === undefined) throw new ContentRequestNotFound();
        return requestOf(row, null);
      }),
    cancel: (creatorId, userId, requestId, now) =>
      asTeam(creatorId, userId, async (tx) => {
        const request = await readRequest(tx, requestId);
        if (request === undefined) throw new ContentRequestNotFound();
        if (request.state === 'cancelled') return;
        if (request.state !== 'open' || (await readRequest(tx, requestId, true)) === undefined)
          throw new ContentRequestClosed();
        await tx
          .update(contentRequests)
          .set({ state: 'cancelled', decidedAt: now, updatedAt: now })
          .where(eq(contentRequests.id, requestId));
      }),
  };
}
