import { Readable } from 'node:stream';

import {
  CompleteDropFileBodySchema,
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ContentDropSchema,
  ContentRequestIdSchema,
  ContentRequestSchema,
  CorrectDropCategoryBodySchema,
  CorrectDropDescriptionBodySchema,
  CreateContentDropBodySchema,
  CreateContentRequestBodySchema,
  CreatorContentSchema,
  CreatorIdSchema,
  DomainError,
  DropFileUploadSchema,
  FillScriptSlotBodySchema,
  RefuseContentRequestBodySchema,
  SCRIPT_EXPORT_MEDIA_TYPE,
  ScriptDropCardParamsSchema,
  ScriptDropCardQuerySchema,
  ScriptDropSchema,
  ScriptSlotParamsSchema,
  DropDescriptionsReviewSchema,
  DropDescriptionsSwitchSchema,
  StartScriptDropBodySchema,
  ValidateDropDescriptionsBodySchema,
  ValidateScriptSummaryBodySchema,
  WriteDropDescriptionBodySchema,
  CorrectScriptSummaryBodySchema,
  type UserRole,
} from '@impera/contracts';
import { NotACreatorAccount } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { exportDrop } from '../../application/drop-export';
import {
  fillScriptSlot,
  readScriptDrop,
  scriptDropCard,
  startScriptDrop,
  submitScriptDrop,
  type ScriptDropDeps,
} from '../../application/script-drops';
import { exportScript } from '../../application/script-export';
import { finishUpload, uploadOf } from '../../application/uploads';
import { byteRangeOf } from '../../domain/byte-range';
import { ContentDropFileNotFound, DropDescriptionsCreatorNotFound } from '../../domain/errors';
import type {
  AgencyContentStore,
  CreatorContentStore,
  DescribeSwitch,
  DescriptionReview,
  DropStorage,
} from '../../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

/** A `creator` session whose account is not linked to exactly one creator (the base forbids it): refused. */
class CreatorAccountForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Ce compte n’est lié à aucune créatrice');
  }
}

function signedIn(user: { readonly id: string } | null): string {
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return user.id;
}

async function asCreator<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NotACreatorAccount) throw new CreatorAccountForbidden();
    throw error;
  }
}

const DropParamsSchema = z.object({ id: ContentDropIdSchema });
const RequestParamsSchema = z.object({ id: ContentRequestIdSchema });
const CreatorParamsSchema = z.object({ creatorId: CreatorIdSchema });
const CreatorDropParamsSchema = z.object({ creatorId: CreatorIdSchema, id: ContentDropIdSchema });
const FileParamsSchema = z.object({ id: ContentDropIdSchema, fileId: ContentDropFileIdSchema });
const CreatorFileParamsSchema = z.object({
  creatorId: CreatorIdSchema,
  id: ContentDropIdSchema,
  fileId: ContentDropFileIdSchema,
});
const CreatorRequestParamsSchema = z.object({ creatorId: CreatorIdSchema, id: ContentRequestIdSchema });
/** Short: a picture made meanwhile shows within minutes; the browser does not ask at each page. */
const THUMBNAIL_CACHE_SECONDS = 300;
const ScriptDropParamsSchema = z.object({ dropId: ContentDropIdSchema });

/**
 * Her content under `/v1/creator-space` (creator, CR-06), and the agency's under `/v1/creators/:creatorId` (owner,
 * operator: the store refuses a chatter). Her creator is read in her account, never in the request. `now` is the
 * server's clock.
 */
export function createContentDropRoutes(
  creator: CreatorContentStore,
  agency: AgencyContentStore,
  storage: DropStorage,
  scripts: ScriptDropDeps,
  describeSwitch: DescribeSwitch,
  review: DescriptionReview,
  requireRole: RequireRole,
  clock: () => Date = () => new Date(),
): FastifyPluginAsyncZod {
  return (app) => {
    const creatorOnly = { preValidation: requireRole('creator') };
    const team = { preValidation: requireRole('owner', 'operator') };
    const owner = { preValidation: requireRole('owner') };

    app.get(
      '/creator-space/content',
      { ...creatorOnly, schema: { response: { 200: CreatorContentSchema } } },
      (request) => asCreator(() => creator.content(signedIn(request.user))),
    );

    app.post(
      '/creator-space/drops',
      { ...creatorOnly, schema: { body: CreateContentDropBodySchema, response: { 200: ContentDropSchema } } },
      (request) => asCreator(() => creator.drop(signedIn(request.user), request.body)),
    );

    app.delete(
      '/creator-space/drops/:id',
      { ...creatorOnly, schema: { params: DropParamsSchema } },
      async (request, reply) => {
        await asCreator(() => creator.withdraw(signedIn(request.user), request.params.id, clock()));
        return reply.code(204).send();
      },
    );

    app.post(
      '/creator-space/content-requests/:id/refuse',
      { ...creatorOnly, schema: { params: RequestParamsSchema, body: RefuseContentRequestBodySchema } },
      async (request, reply) => {
        await asCreator(() =>
          creator.refuse(signedIn(request.user), request.params.id, request.body.reason, clock()),
        );
        return reply.code(204).send();
      },
    );

    // Her file's bytes, straight to the storage (CR-06 b): where to send them, then « every part sent ».
    app.post(
      '/creator-space/drops/:id/files/:fileId/upload',
      { ...creatorOnly, schema: { params: FileParamsSchema, response: { 200: DropFileUploadSchema } } },
      (request) =>
        asCreator(async () =>
          uploadOf(
            storage,
            await creator.fileTarget(signedIn(request.user), request.params.id, request.params.fileId),
          ),
        ),
    );

    app.post(
      '/creator-space/drops/:id/files/:fileId/complete',
      {
        ...creatorOnly,
        schema: {
          params: FileParamsSchema,
          body: CompleteDropFileBodySchema,
          response: { 200: ContentDropSchema },
        },
      },
      (request) =>
        asCreator(async () => {
          const userId = signedIn(request.user);
          const { id, fileId } = request.params;
          await finishUpload(storage, await creator.fileTarget(userId, id, fileId), request.body.parts);
          return creator.markSent(userId, id, fileId, request.id);
        }),
    );

    // Her script, slot by slot (SC-02 lot b, ADR 0056 § 4): begun from her request, each slot's file declared as she
    // chooses it (its bytes go up by the routes above), then « Envoyer le script ».
    app.post(
      '/creator-space/content/script-drops',
      { ...creatorOnly, schema: { body: StartScriptDropBodySchema, response: { 200: ScriptDropSchema } } },
      (request) => asCreator(() => startScriptDrop(scripts, signedIn(request.user), request.body)),
    );

    app.get(
      '/creator-space/content/script-drops/:dropId',
      { ...creatorOnly, schema: { params: ScriptDropParamsSchema, response: { 200: ScriptDropSchema } } },
      (request) => asCreator(() => readScriptDrop(scripts, signedIn(request.user), request.params.dropId)),
    );

    // A card of her script (SC-02 lot b2), drawn from its frozen version: the same SVG and the same headers as the
    // library's, what the agency wrote escaped, nothing else allowed by the CSP.
    app.get(
      '/creator-space/content/script-drops/:dropId/cards/:segmentKey',
      {
        ...creatorOnly,
        schema: { params: ScriptDropCardParamsSchema, querystring: ScriptDropCardQuerySchema },
      },
      async (request, reply) => {
        const svg = await asCreator(() =>
          scriptDropCard(
            scripts,
            signedIn(request.user),
            request.params.dropId,
            request.params.segmentKey,
            request.query.variant ?? null,
          ),
        );
        return reply
          .header('cache-control', 'private, no-cache')
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', "default-src 'none'")
          .type('image/svg+xml; charset=utf-8')
          .send(svg);
      },
    );

    app.put(
      '/creator-space/content/script-drops/:dropId/slots/:slotKey',
      {
        ...creatorOnly,
        schema: {
          params: ScriptSlotParamsSchema,
          body: FillScriptSlotBodySchema,
          response: { 200: ContentDropSchema },
        },
      },
      (request) =>
        asCreator(() =>
          fillScriptSlot(
            scripts,
            signedIn(request.user),
            request.params.dropId,
            request.params.slotKey,
            request.body,
            clock(),
          ),
        ),
    );

    app.post(
      '/creator-space/content/script-drops/:dropId/submit',
      { ...creatorOnly, schema: { params: ScriptDropParamsSchema, response: { 200: ContentDropSchema } } },
      (request) =>
        asCreator(() =>
          submitScriptDrop(scripts, signedIn(request.user), request.params.dropId, clock(), request.id),
        ),
    );

    app.get(
      '/creators/:creatorId/content',
      { ...team, schema: { params: CreatorParamsSchema, response: { 200: CreatorContentSchema } } },
      (request) => agency.content(request.params.creatorId, signedIn(request.user)),
    );

    app.post(
      '/creators/:creatorId/drops',
      {
        ...team,
        schema: {
          params: CreatorParamsSchema,
          body: CreateContentDropBodySchema,
          response: { 200: ContentDropSchema },
        },
      },
      (request) => agency.drop(request.params.creatorId, signedIn(request.user), request.body),
    );

    app.patch(
      '/creators/:creatorId/drops/:id',
      {
        ...team,
        schema: {
          params: CreatorDropParamsSchema,
          body: CorrectDropCategoryBodySchema,
          response: { 200: ContentDropSchema },
        },
      },
      (request) =>
        agency.correct(
          request.params.creatorId,
          signedIn(request.user),
          request.params.id,
          request.body.category,
          clock(),
        ),
    );

    app.delete(
      '/creators/:creatorId/drops/:id',
      { ...team, schema: { params: CreatorDropParamsSchema } },
      async (request, reply) => {
        await agency.withdraw(request.params.creatorId, signedIn(request.user), request.params.id, clock());
        return reply.code(204).send();
      },
    );

    app.post(
      '/creators/:creatorId/drops/:id/files/:fileId/upload',
      { ...team, schema: { params: CreatorFileParamsSchema, response: { 200: DropFileUploadSchema } } },
      async (request) => {
        const { creatorId, id, fileId } = request.params;
        return uploadOf(storage, await agency.fileTarget(creatorId, signedIn(request.user), id, fileId));
      },
    );

    app.post(
      '/creators/:creatorId/drops/:id/files/:fileId/complete',
      {
        ...team,
        schema: {
          params: CreatorFileParamsSchema,
          body: CompleteDropFileBodySchema,
          response: { 200: ContentDropSchema },
        },
      },
      async (request) => {
        const userId = signedIn(request.user);
        const { creatorId, id, fileId } = request.params;
        await finishUpload(
          storage,
          await agency.fileTarget(creatorId, userId, id, fileId),
          request.body.parts,
        );
        return agency.markSent(creatorId, userId, id, fileId, request.id);
      },
    );

    // A sent script's folder as a ZIP (SC-03 c): streamed as it is zipped, her media in it, never kept by a cache.
    app.get(
      '/creators/:creatorId/drops/:id/script-export',
      { ...team, schema: { params: CreatorDropParamsSchema } },
      async (request, reply) => {
        const archive = await exportScript(
          { agency, versions: scripts.versions, storage },
          request.params.creatorId,
          signedIn(request.user),
          request.params.id,
          clock(),
        );
        return reply
          .header('content-type', SCRIPT_EXPORT_MEDIA_TYPE)
          .header('content-disposition', `attachment; filename="${archive.fileName}"`)
          .header('cache-control', 'no-store')
          .header('x-content-type-options', 'nosniff')
          .send(archive.stream);
      },
    );

    // « Copié dans Reveal » (SC-03 c): her originals of the script go 30 days later.
    app.post(
      '/creators/:creatorId/drops/:id/script-export/confirm',
      { ...team, schema: { params: CreatorDropParamsSchema, response: { 200: ContentDropSchema } } },
      (request) =>
        agency.confirmExport(request.params.creatorId, signedIn(request.user), request.params.id, clock()),
    );

    // Any other drop of hers as a ZIP (recette créatrice 1): her media in her order and the sheet, streamed as zipped.
    app.get(
      '/creators/:creatorId/drops/:id/export',
      { ...team, schema: { params: CreatorDropParamsSchema } },
      async (request, reply) => {
        const archive = await exportDrop(
          { agency, storage },
          request.params.creatorId,
          signedIn(request.user),
          request.params.id,
          clock(),
        );
        return reply
          .header('content-type', SCRIPT_EXPORT_MEDIA_TYPE)
          .header('content-disposition', `attachment; filename="${archive.fileName}"`)
          .header('cache-control', 'no-store')
          .header('x-content-type-options', 'nosniff')
          .send(archive.stream);
      },
    );

    // Put out by hand (ADR 0044, recette créatrice 1): her originals of the drop go 30 days later.
    app.post(
      '/creators/:creatorId/drops/:id/export/confirm',
      { ...team, schema: { params: CreatorDropParamsSchema, response: { 200: ContentDropSchema } } },
      (request) =>
        agency.confirmDropExport(
          request.params.creatorId,
          signedIn(request.user),
          request.params.id,
          clock(),
        ),
    );

    app.post(
      '/creators/:creatorId/content-requests',
      {
        ...team,
        schema: {
          params: CreatorParamsSchema,
          body: CreateContentRequestBodySchema,
          response: { 200: ContentRequestSchema },
        },
      },
      (request) => {
        const userId = signedIn(request.user);
        // A script asked by hand shoots a frozen version too (SC-02 lot b), frozen by the one who asks.
        return agency.ask(
          request.params.creatorId,
          userId,
          request.body,
          (structureId) => scripts.versions.freeze(structureId, userId),
          clock(),
        );
      },
    );

    app.delete(
      '/creators/:creatorId/content-requests/:id',
      { ...team, schema: { params: CreatorRequestParamsSchema } },
      async (request, reply) => {
        await agency.cancel(request.params.creatorId, signedIn(request.user), request.params.id, clock());
        return reply.code(204).send();
      },
    );

    // The review of a drop's descriptions and of a script's synthesis (ADR 0030 § 3, ADR 0083 § 7): each write stamped
    // with the account that makes it, each answering the drop's review as it now stands.
    app.get(
      '/creators/:creatorId/drops/:id/descriptions',
      {
        ...team,
        schema: { params: CreatorDropParamsSchema, response: { 200: DropDescriptionsReviewSchema } },
      },
      (request) => review.read(request.params.creatorId, signedIn(request.user), request.params.id),
    );

    app.post(
      '/creators/:creatorId/drops/:id/descriptions/validate',
      {
        ...team,
        schema: {
          params: CreatorDropParamsSchema,
          body: ValidateDropDescriptionsBodySchema,
          response: { 200: DropDescriptionsReviewSchema },
        },
      },
      (request) =>
        review.validate(
          request.params.creatorId,
          signedIn(request.user),
          request.params.id,
          request.body.descriptionIds,
          clock(),
          request.id,
        ),
    );

    app.post(
      '/creators/:creatorId/drops/:id/descriptions/correct',
      {
        ...team,
        schema: {
          params: CreatorDropParamsSchema,
          body: CorrectDropDescriptionBodySchema,
          response: { 200: DropDescriptionsReviewSchema },
        },
      },
      (request) =>
        review.correct(
          request.params.creatorId,
          signedIn(request.user),
          request.params.id,
          request.body.descriptionId,
          request.body.detailed,
          clock(),
          request.id,
        ),
    );

    // Her medium's reduced picture (SC-04 lot c4, ADR 0030 § 4), from our own origin (the CRM's CSP: `img-src 'self'`).
    app.get(
      '/creators/:creatorId/drops/:id/files/:fileId/thumbnail',
      { ...team, schema: { params: CreatorFileParamsSchema } },
      async (request, reply) => {
        const { creatorId, id, fileId } = request.params;
        const file = await review.file(creatorId, signedIn(request.user), id, fileId);
        if (file?.thumbnailKey == null) throw new ContentDropFileNotFound();
        const stream = await storage.read(file.thumbnailKey);
        if (stream === null) throw new ContentDropFileNotFound();
        return reply
          .header('content-type', 'image/jpeg')
          .header('cache-control', `private, max-age=${String(THUMBNAIL_CACHE_SECONDS)}`)
          .header('x-content-type-options', 'nosniff')
          .send(Readable.from(stream));
      },
    );

    /*
     * Her medium itself while its original is held (SC-04 lot c4, ADR 0044 § 2), from our own origin (`media-src
     * 'self'`): a photo whole, a video in the parts its player asks (`Range`). Each opening is audited, not each part.
     */
    app.get(
      '/creators/:creatorId/drops/:id/files/:fileId/media',
      { ...team, schema: { params: CreatorFileParamsSchema } },
      async (request, reply) => {
        const { creatorId, id, fileId } = request.params;
        const userId = signedIn(request.user);
        const file = await review.file(creatorId, userId, id, fileId);
        if (file?.originalKey == null) throw new ContentDropFileNotFound();
        const range = byteRangeOf(request.headers.range, file.bytes);
        if (range.kind === 'unsatisfiable')
          return reply
            .code(416)
            .header('content-range', `bytes */${String(file.bytes)}`)
            .send();
        const part = range.kind === 'part' ? { start: range.start, end: range.end } : undefined;
        const stream = await storage.read(file.originalKey, part);
        if (stream === null) throw new ContentDropFileNotFound();
        if (part === undefined || part.start === 0) await review.opened(creatorId, userId, file, request.id);
        reply
          .header('content-type', file.mime)
          .header('accept-ranges', 'bytes')
          .header('cache-control', 'private, no-store')
          .header('x-content-type-options', 'nosniff')
          .header('content-disposition', 'inline');
        if (part === undefined) reply.header('content-length', String(file.bytes));
        else
          reply
            .code(206)
            .header('content-range', `bytes ${String(part.start)}-${String(part.end)}/${String(file.bytes)}`)
            .header('content-length', String(part.end - part.start + 1));
        return reply.send(Readable.from(stream));
      },
    );

    app.post(
      '/creators/:creatorId/drops/:id/summary/validate',
      {
        ...team,
        schema: {
          params: CreatorDropParamsSchema,
          body: ValidateScriptSummaryBodySchema,
          response: { 200: DropDescriptionsReviewSchema },
        },
      },
      (request) =>
        review.validateSummary(
          request.params.creatorId,
          signedIn(request.user),
          request.params.id,
          request.body.summaryId,
          clock(),
        ),
    );

    // The vision AI asked again on a medium it gave up (recette créatrice 2): her team's, as each review.
    app.post(
      '/creators/:creatorId/drops/:id/files/:fileId/describe',
      {
        ...team,
        schema: { params: CreatorFileParamsSchema, response: { 200: DropDescriptionsReviewSchema } },
      },
      (request) =>
        review.retryDescription(
          request.params.creatorId,
          signedIn(request.user),
          request.params.id,
          request.params.fileId,
          request.id,
        ),
    );

    // A medium the AI did not describe, written by hand (recette créatrice 2): its words and its level.
    app.post(
      '/creators/:creatorId/drops/:id/files/:fileId/description',
      {
        ...team,
        schema: {
          params: CreatorFileParamsSchema,
          body: WriteDropDescriptionBodySchema,
          response: { 200: DropDescriptionsReviewSchema },
        },
      },
      (request) =>
        review.writeDescription(
          request.params.creatorId,
          signedIn(request.user),
          request.params.id,
          request.params.fileId,
          { detailed: request.body.detailed, intensity: request.body.intensity },
          clock(),
          request.id,
        ),
    );

    app.post(
      '/creators/:creatorId/drops/:id/summary/correct',
      {
        ...team,
        schema: {
          params: CreatorDropParamsSchema,
          body: CorrectScriptSummaryBodySchema,
          response: { 200: DropDescriptionsReviewSchema },
        },
      },
      (request) =>
        review.correctSummary(
          request.params.creatorId,
          signedIn(request.user),
          request.params.id,
          request.body.summaryId,
          { shootingContext: request.body.shootingContext, steps: request.body.steps },
          clock(),
        ),
    );

    // Her switch (ADR 0083 § 9): the owner's alone, turned on once the vision model is checked on her real media.
    // Turned on, what she dropped meanwhile is described and her sent scripts told.
    app.get(
      '/creators/:creatorId/drop-descriptions',
      { ...owner, schema: { params: CreatorParamsSchema, response: { 200: DropDescriptionsSwitchSchema } } },
      async (request) => {
        const on = await describeSwitch.read(request.params.creatorId);
        if (on === null) throw new DropDescriptionsCreatorNotFound();
        return { on };
      },
    );

    app.put(
      '/creators/:creatorId/drop-descriptions',
      {
        ...owner,
        schema: {
          params: CreatorParamsSchema,
          body: DropDescriptionsSwitchSchema,
          response: { 200: DropDescriptionsSwitchSchema },
        },
      },
      async (request) => {
        const on = await describeSwitch.set(
          request.params.creatorId,
          request.body.on,
          signedIn(request.user),
        );
        if (on === null) throw new DropDescriptionsCreatorNotFound();
        return { on };
      },
    );

    return Promise.resolve();
  };
}
