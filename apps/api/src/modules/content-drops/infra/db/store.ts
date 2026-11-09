import {
  JOB_MAX_ATTEMPTS,
  AuditEntryIdSchema,
  calendarDayAt,
  EventIdSchema,
  MediaAssetIdSchema,
  type DropFileState,
  ContentDropFileIdSchema,
  ContentDropSchema,
  ContentRequestIdSchema,
  ContentRequestSchema,
  DropCategorySchema,
  DropFileStateSchema,
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
  ScriptMomentSchema,
  ShotMomentSchema,
  type ShotMoment,
} from '@impera/contracts';
import {
  and,
  eq,
  inArray,
  schema,
  sql,
  withCreatorAccount,
  withAdmin,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';

import { dropRefusals, mayWithdraw, needsRequest } from '../../domain/drops';
import {
  ContentDropExportUnprocessable,
  ContentDropFileNotFound,
  ContentDropFileSettled,
  ContentDropFormatUnprocessable,
  ContentDropForbidden,
  ContentDropIdConflict,
  ContentDropNotFound,
  ContentDropRequestUnprocessable,
  ContentDropScriptUnprocessable,
  ContentDropSettled,
  ContentRequestClosed,
  ContentRequestDueUnprocessable,
  ContentRequestIdConflict,
  ContentRequestNotFound,
  ContentRequestStructureUnprocessable,
  MediumErasedMeanwhile,
} from '../../domain/errors';
import type {
  AgencyContentStore,
  CreatorContentStore,
  DropFileTarget,
  FileOutcome,
  AskedScript,
  IdeaContentRequest,
  SentScript,
  ScriptContentRequest,
  ReceiptStore,
} from '../../domain/ports';
import { keptUntil } from '../../domain/retention';
import { shotMoment } from '../../domain/shot-moment';

import { enqueueDescription } from './description-queue';
import { enqueueThumbnail } from './thumbnail-queue';

const { auditLog, contentDropFiles, contentDrops, contentRequests } = schema;

type DropRow = typeof contentDrops.$inferSelect;
type FileRow = typeof contentDropFiles.$inferSelect;
type RequestRow = typeof contentRequests.$inferSelect;

/** How many of her latest drops a read returns: her screen shows the recent ones, the rest stays in the base. */
const DROPS_READ = 100;

/** The Postgres error behind a failed query (Drizzle wraps it as `cause`). */
export function pgErrorOf(error: unknown): { code: string; constraint: string | null } | null {
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
        slotKey: file.slotKey,
      })),
    scriptNumber: row.scriptNumber,
    exportedAt: row.exportedAt?.toISOString() ?? null,
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
    structureVersionId: row.structureVersionId,
    moment: row.moment,
    origin: row.origin,
    state: row.state,
    refusalReason: row.refusalReason,
    dropId,
    createdAt: row.createdAt.toISOString(),
  });
}

/** The live files of these drops: a file replaced in its slot (SC-02 lot b) is in no view and moves no drop. */
async function filesOf(tx: Transaction, dropIds: readonly string[]): Promise<FileRow[]> {
  if (dropIds.length === 0) return [];
  return tx
    .select()
    .from(contentDropFiles)
    .where(and(inArray(contentDropFiles.dropId, [...dropIds]), sql`${contentDropFiles.replacedAt} is null`));
}

export async function readDrop(tx: Transaction, dropId: string, lock = false): Promise<DropRow | undefined> {
  const query = tx.select().from(contentDrops).where(eq(contentDrops.id, dropId));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

/**
 * A request as the reader sees it; locked, through the update policy too, which hides a request the reader may no
 * longer change: read it unlocked first to tell « not there » from « closed ».
 */
export async function readRequest(
  tx: Transaction,
  requestId: string,
  lock = false,
): Promise<RequestRow | undefined> {
  const query = tx.select().from(contentRequests).where(eq(contentRequests.id, requestId));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

export async function viewOf(tx: Transaction, row: DropRow): Promise<ContentDrop> {
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
  // A script the team copied into Reveal is out, as a published drop is (recette MED-08): withdrawn, its request would
  // reopen for her to shoot again and its originals would go within the hour.
  if (seen.exportedAt !== null || !mayWithdraw(DropStateSchema.parse(seen.state), by))
    throw new ContentDropSettled();
  // Locked through the update policy, which hides a drop the job scheduled meanwhile.
  const row = await readDrop(tx, dropId, true);
  if (row?.exportedAt !== null || !mayWithdraw(DropStateSchema.parse(row.state), by))
    throw new ContentDropSettled();
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

/** A file of a drop the reader sees, with the drop's state; a withdrawn drop is still found (its sender is told). */
async function fileTargetIn(tx: Transaction, dropId: string, fileId: string): Promise<DropFileTarget> {
  const drop = await readDrop(tx, dropId);
  if (drop === undefined) throw new ContentDropNotFound();
  const [file] = await tx
    .select()
    .from(contentDropFiles)
    .where(and(eq(contentDropFiles.id, fileId), eq(contentDropFiles.dropId, dropId)));
  // Replaced in its slot (SC-02 lot b): out of her script, its bytes no longer go up.
  if (file?.replacedAt !== null) throw new ContentDropFileNotFound();
  return {
    creatorId: drop.creatorId,
    dropId,
    fileId: ContentDropFileIdSchema.parse(fileId),
    mime: DropMimeSchema.parse(file.mime),
    bytes: file.bytes,
    fileState: DropFileStateSchema.parse(file.state),
    dropState: DropStateSchema.parse(drop.state),
    lengths:
      file.minSeconds === null || file.maxSeconds === null
        ? null
        : { minSeconds: file.minSeconds, maxSeconds: file.maxSeconds },
  };
}

/**
 * The receipt of a file whose bytes are whole, enqueued with the transaction (ADR 0006): one per file, the first one
 * kept (`preserve_run_at`). A file already past `awaiting` enqueues nothing; a drop that no longer sends refuses.
 */
async function markSentIn(
  tx: Transaction,
  dropId: string,
  fileId: string,
  correlationId: string,
): Promise<ContentDrop> {
  const target = await fileTargetIn(tx, dropId, fileId);
  if (target.fileState === 'awaiting') {
    if (target.dropState !== 'uploading' && target.dropState !== 'filling')
      throw new ContentDropFileSettled();
    await tx.execute(
      sql`select public.enqueue_job(
        task => 'content_drops.receive_file',
        payload => ${JSON.stringify({ creatorId: target.creatorId, fileId, correlationId })}::jsonb,
        max_attempts => ${JOB_MAX_ATTEMPTS['content_drops.receive_file']}::int,
        job_key => ${`content_drops.receive_file:${fileId}`},
        job_key_mode => 'preserve_run_at'
      )`,
    );
  }
  const drop = await readDrop(tx, dropId);
  if (drop === undefined) throw new ContentDropNotFound();
  return viewOf(tx, drop);
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
    fileTarget: (userId, dropId, fileId) =>
      withCreatorAccount(db, userId, (tx) => fileTargetIn(tx, dropId, fileId)),
    markSent: (userId, dropId, fileId, correlationId) =>
      withCreatorAccount(db, userId, (tx) => markSentIn(tx, dropId, fileId, correlationId)),
  };
}

/** The states a sent script is whole in: every file settled, kept, a duplicate or refused (SC-03 c). */
const EXPORTABLE_STATES: ReadonlySet<string> = new Set(['ready', 'scheduled', 'published']);

/**
 * A sent script as its archive reads it, by the team's policies: its number, its request's frozen version, each live
 * file of a slot that the library keeps (a refused one has no medium, an empty slot no file). An original already
 * erased refuses the whole archive rather than leave a hole in it.
 */
async function sentScriptIn(tx: Transaction, dropId: string): Promise<SentScript> {
  const row = await readDrop(tx, dropId);
  if (row === undefined || row.state === 'withdrawn') throw new ContentDropNotFound();
  if (row.category !== 'script' || row.scriptNumber === null || row.requestId === null)
    throw new ContentDropExportUnprocessable('not_a_script');
  if (!EXPORTABLE_STATES.has(row.state)) throw new ContentDropExportUnprocessable('not_ready');
  const request = await readRequest(tx, row.requestId);
  if (request?.structureVersionId == null) throw new ContentDropExportUnprocessable('not_a_script');
  const files = await tx
    .select({
      slotKey: contentDropFiles.slotKey,
      storageKey: schema.mediaAssets.storageKey,
      mime: schema.mediaAssets.mime,
      bytes: schema.mediaAssets.bytes,
      erasedAt: schema.mediaAssets.erasedAt,
      // Its validated description for the sheet (SC-04 lot c4): never one a human has not read (ADR 0030 § 3).
      description: sql<string | null>`(
        select md.content->>'detailed' from media_descriptions md
         where md.media_asset_id = ${schema.mediaAssets.id} and md.validated_at is not null
           and md.content ? 'detailed'
         order by md.validated_at desc, md.created_at desc, md.id desc
         limit 1)`,
    })
    .from(contentDropFiles)
    .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, contentDropFiles.mediaAssetId))
    .where(
      and(
        eq(contentDropFiles.dropId, dropId),
        sql`${contentDropFiles.replacedAt} is null`,
        sql`${contentDropFiles.slotKey} is not null`,
        inArray(contentDropFiles.state, ['kept', 'duplicate']),
      ),
    );
  if (files.some((file) => file.erasedAt !== null))
    throw new ContentDropExportUnprocessable('original_erased');
  return {
    scriptNumber: row.scriptNumber,
    versionId: request.structureVersionId,
    moment: request.moment === null ? null : ShotMomentSchema.parse(request.moment),
    files: files.flatMap((file) =>
      file.slotKey === null
        ? []
        : [
            {
              slotKey: file.slotKey,
              storageKey: file.storageKey,
              mime: file.mime,
              bytes: file.bytes,
              description: file.description,
            },
          ],
    ),
  };
}

/** Her originals of a script go this long after its archive is confirmed copied into Reveal (ADR 0044 § 2). */
const AFTER_EXPORT_DAYS = 30;

/**
 * The export confirmed, once: who and when on the drop, its audit line, and each original the script kept, that no
 * other live drop of hers holds, brought forward to 30 days from now (never pushed back). Its job of the night takes
 * them as it takes the others (CR-06 c), with their notice before.
 */
async function confirmExportIn(
  tx: Transaction,
  userId: string,
  dropId: string,
  now: Date,
): Promise<ContentDrop> {
  const sent = await sentScriptIn(tx, dropId);
  const row = await readDrop(tx, dropId, true);
  if (row === undefined) throw new ContentDropSettled();
  if (row.exportedAt !== null) return viewOf(tx, row);
  await tx
    .update(contentDrops)
    .set({ exportedAt: now, exportedBy: userId })
    .where(eq(contentDrops.id, dropId));
  const until = new Date(now.getTime() + AFTER_EXPORT_DAYS * 24 * 3600 * 1000);
  const shortened = await tx.execute<{ id: string }>(sql`
    update media_assets m set expires_at = ${until}
     where m.erased_at is null
       and (m.expires_at is null or m.expires_at > ${until})
       and m.id in (
         select f.media_asset_id from content_drop_files f
          where f.drop_id = ${dropId} and f.state = 'kept' and f.replaced_at is null
       )
       and not exists (
         select 1 from content_drop_files o join content_drops d on d.id = o.drop_id
          where o.media_asset_id = m.id and o.drop_id <> ${dropId} and o.replaced_at is null
            and d.state <> 'withdrawn'
       )
    returning m.id`);
  await tx.insert(auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId,
    action: 'content_drop.export_confirmed',
    entity: 'content_drop',
    entityId: dropId,
    details: {
      scriptNumber: sent.scriptNumber,
      originalsUntil: until.toISOString(),
      originals: shortened.rows.length,
    },
  });
  const updated = await readDrop(tx, dropId);
  if (updated === undefined) throw new ContentDropNotFound();
  return viewOf(tx, updated);
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
    ask: (creatorId, userId, body: CreateContentRequestBody, freeze, now) =>
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
        // Never for a day already past where she lives (recette MED-10): it would be late as it is born.
        const [creator] = await tx
          .select({ timezone: schema.creators.timezone })
          .from(schema.creators)
          .where(eq(schema.creators.id, creatorId));
        // `asTeam` has read her already: missing here, she is gone, and the request is refused like any other.
        if (creator === undefined) throw new ContentDropForbidden();
        if (body.dueOn < calendarDayAt(now, creator.timezone)) throw new ContentRequestDueUnprocessable();
        if (body.structureId !== null) {
          // The library's structure, read by the team's policy: not archived, kept for no other creator.
          const [structure] = await tx
            .select({
              reservedCreatorId: schema.scriptStructures.reservedCreatorId,
              archivedAt: schema.scriptStructures.archivedAt,
            })
            .from(schema.scriptStructures)
            .where(eq(schema.scriptStructures.id, body.structureId));
          const usable =
            structure?.archivedAt === null && (structure.reservedCreatorId ?? creatorId) === creatorId;
          if (!usable) throw new ContentRequestStructureUnprocessable();
        }
        // Checked hers first, then frozen (SC-02 lot b): the version she will shoot, whatever the library writes next.
        const versionId = body.structureId === null ? null : await freeze(body.structureId);
        if (body.structureId !== null && versionId === null) throw new ContentRequestStructureUnprocessable();
        try {
          await tx.insert(contentRequests).values({
            id: body.id,
            creatorId,
            category: body.category,
            dueOn: body.dueOn,
            reason: body.reason,
            structureId: body.structureId,
            structureVersionId: versionId,
            moment: versionId === null ? null : await momentIn(tx, creatorId, versionId),
            origin: 'agency',
            createdBy: userId,
          });
        } catch (error) {
          const failure = pgErrorOf(error);
          if (failure?.code === '23505') throw new ContentRequestIdConflict();
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
        // Answered by a drop not withdrawn (her script begun, her files sent), it is no longer the agency's to cancel:
        // she would go on shooting a request gone (recette MED-07). Withdrawing that drop first reopens it.
        const [answer] = await tx
          .select({ id: contentDrops.id })
          .from(contentDrops)
          .where(and(eq(contentDrops.requestId, requestId), sql`${contentDrops.state} <> 'withdrawn'`));
        if (answer !== undefined) throw new ContentRequestClosed();
        await tx
          .update(contentRequests)
          .set({ state: 'cancelled', decidedAt: now, updatedAt: now })
          .where(eq(contentRequests.id, requestId));
      }),
    fileTarget: (creatorId, userId, dropId, fileId) =>
      asTeam(creatorId, userId, (tx) => fileTargetIn(tx, dropId, fileId)),
    markSent: (creatorId, userId, dropId, fileId, correlationId) =>
      asTeam(creatorId, userId, (tx) => markSentIn(tx, dropId, fileId, correlationId)),
    sentScript: (creatorId, userId, dropId) => asTeam(creatorId, userId, (tx) => sentScriptIn(tx, dropId)),
    confirmExport: (creatorId, userId, dropId, now) =>
      asTeam(creatorId, userId, (tx) => confirmExportIn(tx, userId, dropId, now)),
  };
}

/** The drop's sentence when none of its files could be kept (ADR 0055 § 6: blocked, in amber, with its reason). */
const NOTHING_KEPT = 'Aucun fichier de ce dépôt n’a pu être gardé';

/** The states each outcome moves a file from: a file already past them is left as it is (a replayed job). */
const MOVES_FROM: Readonly<Record<FileOutcome['state'], readonly DropFileState[]>> = {
  received: ['awaiting'],
  refused: ['awaiting', 'received'],
  kept: ['received'],
};

/**
 * A request born of an idea of the trend watch (VEI-01 d2), written by its job under the owner's role: origin `idea`,
 * no author (`content_requests_author_check`), under the idea's own id, so that a replay writes nothing more.
 */
export async function requestFromIdea(adminDb: Database, request: IdeaContentRequest): Promise<void> {
  await withAdmin(adminDb, async (tx) => {
    await tx
      .insert(contentRequests)
      .values({
        id: request.id,
        creatorId: request.creatorId,
        category: request.category,
        dueOn: request.dueOn,
        reason: request.reason,
        structureId: null,
        origin: 'idea',
        createdBy: null,
      })
      .onConflictDoNothing({ target: contentRequests.id });
  });
}

/**
 * The moment the script asked of her is shot as (« ok alternance », SC-03): read under a lock on her requests' moments,
 * so that two scripts asked at once never take the same turn. Her last script is the last asked and not cancelled.
 */
async function momentIn(tx: Transaction, creatorId: string, versionId: string): Promise<ShotMoment> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('content_requests.moment:' || ${creatorId}))`);
  const [version] = await tx
    .select({ moment: schema.scriptStructureVersions.moment })
    .from(schema.scriptStructureVersions)
    .where(eq(schema.scriptStructureVersions.id, versionId));
  if (version === undefined) throw new ContentRequestStructureUnprocessable();
  const [last] = await tx
    .select({ moment: contentRequests.moment })
    .from(contentRequests)
    .where(
      and(
        eq(contentRequests.creatorId, creatorId),
        sql`${contentRequests.moment} is not null`,
        sql`${contentRequests.state} <> 'cancelled'`,
      ),
    )
    .orderBy(sql`${contentRequests.createdAt} desc`, sql`${contentRequests.id} desc`)
    .limit(1);
  return shotMoment(
    ScriptMomentSchema.parse(version.moment),
    last?.moment == null ? null : ShotMomentSchema.parse(last.moment),
  );
}

/**
 * The script the cadence asks of her (SC-02, ADR 0056 § 2), written by `scripts.ask_scripts` under the owner's role:
 * origin `cadence`, no author, with the version frozen for it. One per due day (`content_requests_cadence_unique`): a
 * replay writes nothing more.
 */
export async function requestScript(adminDb: Database, request: ScriptContentRequest): Promise<void> {
  await withAdmin(adminDb, async (tx) => {
    await tx
      .insert(contentRequests)
      .values({
        id: newId(ContentRequestIdSchema),
        creatorId: request.creatorId,
        category: 'script',
        dueOn: request.dueOn,
        reason: request.reason,
        structureId: request.structureId,
        structureVersionId: request.structureVersionId,
        moment: await momentIn(tx, request.creatorId, request.structureVersionId),
        origin: 'cadence',
        createdBy: null,
      })
      .onConflictDoNothing();
  });
}

async function lastScriptIn(tx: Transaction, creatorId: string): Promise<AskedScript | null> {
  const [row] = await tx
    .select({
      dueOn: contentRequests.dueOn,
      structureId: contentRequests.structureId,
      createdAt: contentRequests.createdAt,
    })
    .from(contentRequests)
    .where(and(eq(contentRequests.creatorId, creatorId), eq(contentRequests.origin, 'cadence')))
    .orderBy(sql`${contentRequests.dueOn} desc`)
    .limit(1);
  if (row?.structureId == null) return null;
  return { dueOn: row.dueOn, structureId: row.structureId, askedAt: row.createdAt };
}

/** Her last script asked by the cadence, whatever became of it; `null` before the first. For the hourly job. */
export async function lastScriptRequest(adminDb: Database, creatorId: string): Promise<AskedScript | null> {
  return withAdmin(adminDb, (tx) => lastScriptIn(tx, creatorId));
}

/**
 * The same, read for a member of her team under row-level security (`withTenantMember`): the owner or an active
 * manager; `null` for anyone else, who reads no request of hers (audit RLS, 06/11).
 */
export async function lastScriptRequestFor(
  db: Database,
  creatorId: string,
  userId: string,
): Promise<AskedScript | null> {
  return withTenantMember(db, creatorId, userId, (tx, scope) =>
    readsTeam(scope) ? lastScriptIn(tx, creatorId) : Promise.resolve(null),
  );
}

/** Where conversions pass one at a time (ADR 0070 § 4): a long one never takes the whole machine. */
const CONVERSION_QUEUE = 'content_drops:convert';

/**
 * The drop follows its live files, as the admin role, the drop locked by the caller: received with
 * `content_drop_received` once none waits for its bytes (and `content_drops.drop_received` for a drop answering a
 * request), then ready when every file is settled and one was kept, blocked when all were refused. A drop still being
 * filled (SC-02 lot b) moves only once she sends it.
 */
export async function follow(
  tx: Transaction,
  drop: DropRow,
  now: Date,
  correlationId: string,
): Promise<void> {
  const states = (await filesOf(tx, [drop.id])).map((one) => one.state);
  let state = drop.state;
  if (state === 'uploading' && !states.includes('awaiting')) {
    state = 'received';
    await tx.update(contentDrops).set({ state, updatedAt: now }).where(eq(contentDrops.id, drop.id));
    // In the same transaction, once per drop: the drop was locked and still sending.
    await tx.insert(schema.domainEvents).values({
      id: newId(EventIdSchema),
      creatorId: drop.creatorId,
      type: 'content_drop_received',
      payload: { dropId: drop.id, requestId: drop.requestId },
      actor: 'system',
      correlationId,
      createdAt: now,
    });
    // A drop answering a request: the trend watch moves the idea that asked it (VEI-01 d3).
    if (drop.requestId !== null)
      await tx.execute(
        sql`select public.enqueue_job(
          task => 'content_drops.drop_received',
          payload => ${JSON.stringify({ creatorId: drop.creatorId, dropId: drop.id, requestId: drop.requestId })}::jsonb,
          max_attempts => ${JOB_MAX_ATTEMPTS['content_drops.drop_received']}::int,
          job_key => ${`content_drops.drop_received:${drop.id}`}
        )`,
      );
  }
  if (state === 'received' && !states.includes('awaiting') && !states.includes('received')) {
    const kept = states.some((one) => one === 'kept' || one === 'duplicate');
    await tx
      .update(contentDrops)
      .set(
        kept
          ? { state: 'ready', updatedAt: now }
          : { state: 'blocked', blockedReason: NOTHING_KEPT, updatedAt: now },
      )
      .where(eq(contentDrops.id, drop.id));
  }
}

/**
 * The receipt job's side, as the admin role (`withAdmin`): the states of a drop move by the job only (0108's trigger
 * refuses them to the team, her policies to her).
 */
export function createDrizzleReceiptStore(adminDb: Database): ReceiptStore {
  return {
    pending: (fileId) =>
      withAdmin(adminDb, async (tx) => {
        const [file] = await tx.select().from(contentDropFiles).where(eq(contentDropFiles.id, fileId));
        if (file === undefined) return null;
        const drop = await readDrop(tx, file.dropId);
        if (drop === undefined) return null;
        return {
          ...(await fileTargetIn(tx, file.dropId, fileId)),
          category: DropCategorySchema.parse(drop.category),
        };
      }),
    knownMedia: (creatorId, sha256) =>
      withAdmin(adminDb, async (tx) => {
        const [known] = await tx
          .select({ id: schema.mediaAssets.id })
          .from(schema.mediaAssets)
          .where(
            and(
              eq(schema.mediaAssets.creatorId, creatorId),
              eq(schema.mediaAssets.sha256, sha256),
              // Erased (CR-06 c), its bytes are no longer held: they are written again.
              sql`${schema.mediaAssets.erasedAt} is null`,
            ),
          );
        return known?.id ?? null;
      }),
    settle: (fileId, outcome, now, correlationId) =>
      withAdmin(adminDb, async (tx) => {
        const [seen] = await tx.select().from(contentDropFiles).where(eq(contentDropFiles.id, fileId));
        if (seen === undefined) return;
        // The drop first, as every writer of its files does: two receipts of one drop run one after the other.
        const drop = await readDrop(tx, seen.dropId, true);
        if (drop === undefined || drop.state === 'withdrawn') return;
        const [file] = await tx
          .select()
          .from(contentDropFiles)
          .where(eq(contentDropFiles.id, fileId))
          .for('update');
        if (file === undefined || !MOVES_FROM[outcome.state].includes(DropFileStateSchema.parse(file.state)))
          return;
        if (outcome.state === 'kept') {
          const { media } = outcome;
          // Kept a year from today while no exit is planned (CR-06 c, ADR 0055 § 7).
          const until = keptUntil(now);
          // Her library holds each fingerprint once (ADR 0030 § 1): a file she already gave is a duplicate.
          const inserted = await tx
            .insert(schema.mediaAssets)
            .values({
              id: newId(MediaAssetIdSchema),
              creatorId: drop.creatorId,
              kind: media.kind,
              origin: 'creator',
              storageKey: media.storageKey,
              mime: media.mime,
              bytes: media.bytes,
              durationMs: media.durationMs,
              sha256: media.sha256,
              expiresAt: until,
            })
            .onConflictDoNothing()
            .returning({ id: schema.mediaAssets.id });
          const [known] = await tx
            .select({ id: schema.mediaAssets.id, erasedAt: schema.mediaAssets.erasedAt })
            .from(schema.mediaAssets)
            .where(
              and(
                eq(schema.mediaAssets.creatorId, drop.creatorId),
                eq(schema.mediaAssets.sha256, media.sha256),
              ),
            )
            .for('update');
          if (known === undefined) throw new Error(`media ${media.sha256} neither inserted nor found`);
          // Given again, it is a new drop: its original is held a year from today. Erased already, the bytes this
          // job just wrote under its key are its original again, and this file the one that kept it.
          const revived = inserted.length === 0 && known.erasedAt !== null;
          // Erased after this job found it held: the bytes it skipped are gone, the retry writes them again.
          if (revived && !media.uploaded)
            throw new MediumErasedMeanwhile(`media ${known.id} erased meanwhile`);
          // A medium of her library that came another way than a drop (no date) is left as it is.
          if (inserted.length === 0)
            await tx
              .update(schema.mediaAssets)
              .set({
                expiresAt: sql`case when ${schema.mediaAssets.expiresAt} is null then null
                  else greatest(${schema.mediaAssets.expiresAt}, ${until}) end`,
                ...(revived ? { erasedAt: null, storageKey: media.storageKey } : {}),
              })
              .where(eq(schema.mediaAssets.id, known.id));
          // A new medium of hers is described once (ADR 0083 § 1); a voice note has its transcription elsewhere. Each
          // photo and video gets its reduced picture for the agency's screen (SC-04 lot c4), whatever her switch.
          if (inserted.length > 0 && media.kind !== 'audio') {
            const job = { creatorId: drop.creatorId, mediaAssetId: known.id, correlationId };
            await enqueueDescription(tx, job, null);
            await enqueueThumbnail(tx, job, null);
          }
          await tx
            .update(contentDropFiles)
            .set({
              state: inserted.length > 0 || revived ? 'kept' : 'duplicate',
              mediaAssetId: known.id,
              updatedAt: now,
            })
            .where(eq(contentDropFiles.id, fileId));
        } else {
          await tx
            .update(contentDropFiles)
            .set({
              state: outcome.state,
              refusal: outcome.state === 'refused' ? outcome.refusal : null,
              updatedAt: now,
            })
            .where(eq(contentDropFiles.id, fileId));
        }

        await follow(tx, drop, now, correlationId);
      }),

    enqueue: (task, file, correlationId, runAt) =>
      withAdmin(adminDb, async (tx) => {
        await tx.execute(
          sql`select public.enqueue_job(
            task => ${task},
            payload => ${JSON.stringify({ creatorId: file.creatorId, fileId: file.fileId, correlationId })}::jsonb,
            queue_name => ${task === 'content_drops.convert_file' ? CONVERSION_QUEUE : null}::text,
            run_at => ${runAt === null ? null : runAt.toISOString()}::timestamptz,
            max_attempts => ${JOB_MAX_ATTEMPTS[task]}::int,
            job_key => ${`${task}:${file.fileId}`},
            job_key_mode => 'replace'
          )`,
        );
      }),
  };
}
