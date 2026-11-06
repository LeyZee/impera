import {
  CompleteDropFileBodySchema,
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ContentDropSchema,
  ContentRequestIdSchema,
  ContentRequestSchema,
  CorrectDropCategoryBodySchema,
  CreateContentDropBodySchema,
  CreateContentRequestBodySchema,
  CreatorContentSchema,
  CreatorIdSchema,
  DomainError,
  DropFileUploadSchema,
  FillScriptSlotBodySchema,
  RefuseContentRequestBodySchema,
  ScriptDropSchema,
  ScriptSlotParamsSchema,
  StartScriptDropBodySchema,
  type UserRole,
} from '@impera/contracts';
import { NotACreatorAccount } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  fillScriptSlot,
  readScriptDrop,
  startScriptDrop,
  submitScriptDrop,
  type ScriptDropDeps,
} from '../../application/script-drops';
import { finishUpload, uploadOf } from '../../application/uploads';
import type { AgencyContentStore, CreatorContentStore, DropStorage } from '../../domain/ports';

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
  requireRole: RequireRole,
  clock: () => Date = () => new Date(),
): FastifyPluginAsyncZod {
  return (app) => {
    const creatorOnly = { preValidation: requireRole('creator') };
    const team = { preValidation: requireRole('owner', 'operator') };

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
        return agency.ask(request.params.creatorId, userId, request.body, (structureId) =>
          scripts.versions.freeze(structureId, userId),
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

    return Promise.resolve();
  };
}
