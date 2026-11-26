import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ContentStockSchema,
  CorrectDropDescriptionBodySchema,
  CreatorIdSchema,
  DomainError,
  DropDescriptionsReviewSchema,
  ReadyVideoTypesSchema,
  ValidateDropDescriptionsBodySchema,
} from '@impera/contracts';
import { NotACreatorAccount } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { contentStockOf } from '../../application/stock';
import type { CreatorDescriptionReview, DropStorage } from '../../domain/ports';
import type { StockStore } from '../db/stock-store';

import { CreatorAccountForbidden, type RequireRole } from './routes';
import { sendMedium, sendThumbnail } from './serve-medium';

const CreatorParamsSchema = z.object({ creatorId: CreatorIdSchema });
const DropParamsSchema = z.object({ id: ContentDropIdSchema });
const FileParamsSchema = z.object({ id: ContentDropIdSchema, fileId: ContentDropFileIdSchema });

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

/**
 * Coffre Impera (ADR 0163): her stock by use, for the owner and an active manager under `/v1/creators/:creatorId`, and
 * for herself under `/v1/creator-space`, with what she needs to look at her own media and review their descriptions
 * (§ 4). Her creator is read in her account, never in the request. `now` is the server's clock.
 */
export function createStockRoutes(
  stock: StockStore,
  review: CreatorDescriptionReview,
  storage: DropStorage,
  requireRole: RequireRole,
  clock: () => Date = () => new Date(),
): FastifyPluginAsyncZod {
  return (app) => {
    const creatorOnly = { preValidation: requireRole('creator') };
    const team = { preValidation: requireRole('owner', 'operator') };

    app.get(
      '/creators/:creatorId/stock',
      { ...team, schema: { params: CreatorParamsSchema, response: { 200: ContentStockSchema } } },
      async (request) =>
        contentStockOf(await stock.forTeam(request.params.creatorId, signedIn(request.user)), clock()),
    );

    app.get(
      '/creator-space/stock',
      { ...creatorOnly, schema: { response: { 200: ContentStockSchema } } },
      (request) =>
        asCreator(async () => contentStockOf(await stock.forCreator(signedIn(request.user)), clock())),
    );

    // The types a video to sell may take at the drop (ADR 0163 § 7): names only, never a price.
    app.get(
      '/creators/:creatorId/ready-videos',
      { ...team, schema: { params: CreatorParamsSchema, response: { 200: ReadyVideoTypesSchema } } },
      (request) => stock.readyTypesForTeam(request.params.creatorId, signedIn(request.user)),
    );

    app.get(
      '/creator-space/ready-videos',
      { ...creatorOnly, schema: { response: { 200: ReadyVideoTypesSchema } } },
      (request) => asCreator(() => stock.readyTypesForCreator(signedIn(request.user))),
    );

    app.get(
      '/creator-space/drops/:id/descriptions',
      {
        ...creatorOnly,
        schema: { params: DropParamsSchema, response: { 200: DropDescriptionsReviewSchema } },
      },
      (request) => asCreator(() => review.read(signedIn(request.user), request.params.id)),
    );

    app.post(
      '/creator-space/drops/:id/descriptions/validate',
      {
        ...creatorOnly,
        schema: {
          params: DropParamsSchema,
          body: ValidateDropDescriptionsBodySchema,
          response: { 200: DropDescriptionsReviewSchema },
        },
      },
      (request) =>
        asCreator(() =>
          review.validate(
            signedIn(request.user),
            request.params.id,
            request.body.descriptionIds,
            clock(),
            request.id,
          ),
        ),
    );

    app.post(
      '/creator-space/drops/:id/descriptions/correct',
      {
        ...creatorOnly,
        schema: {
          params: DropParamsSchema,
          body: CorrectDropDescriptionBodySchema,
          response: { 200: DropDescriptionsReviewSchema },
        },
      },
      (request) =>
        asCreator(() =>
          review.correct(
            signedIn(request.user),
            request.params.id,
            request.body.descriptionId,
            request.body.detailed,
            clock(),
            request.id,
          ),
        ),
    );

    app.get(
      '/creator-space/drops/:id/files/:fileId/thumbnail',
      { ...creatorOnly, schema: { params: FileParamsSchema } },
      (request, reply) =>
        asCreator(async () =>
          sendThumbnail(
            reply,
            storage,
            await review.file(signedIn(request.user), request.params.id, request.params.fileId),
          ),
        ),
    );

    app.get(
      '/creator-space/drops/:id/files/:fileId/media',
      { ...creatorOnly, schema: { params: FileParamsSchema } },
      (request, reply) =>
        asCreator(async () => {
          const userId = signedIn(request.user);
          const file = await review.file(userId, request.params.id, request.params.fileId);
          return sendMedium(reply, storage, file, request.headers.range, (seen) =>
            review.opened(userId, seen, request.id),
          );
        }),
    );

    return Promise.resolve();
  };
}
