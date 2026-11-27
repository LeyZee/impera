import {
  CreatorAbsenceSchema,
  CreatorIdSchema,
  CreatorLimitsSchema,
  CreatorStopSchema,
  DomainError,
  LimitParamsSchema,
  NewAbsenceBodySchema,
  NewStopBodySchema,
  type UserRole,
} from '@impera/contracts';
import { NotACreatorAccount } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { CreatorAccountForbidden, LimitsForbidden } from '../../domain/errors';
import type { LimitStore } from '../../domain/ports';
import { readsLimits } from '../../domain/reader';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

function signedIn<U extends { readonly id: string }>(user: U | null): U {
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return user;
}

async function asCreator<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NotACreatorAccount) throw new CreatorAccountForbidden();
    throw error;
  }
}

const CreatorParamsSchema = z.strictObject({ creatorId: CreatorIdSchema });

/**
 * Hers under `/v1/creator-space/limits`, `…/absences` and `…/stops` (Charles, 21/11); her team's under
 * `/v1/creators/:creatorId/limits`, read as her chatter sheet is.
 */
export function createLimitRoutes(
  store: LimitStore,
  requireRole: RequireRole,
  clock: () => Date = () => new Date(),
): FastifyPluginAsyncZod {
  return (app) => {
    const creatorOnly = { preValidation: requireRole('creator') };

    app.get(
      '/creator-space/limits',
      { ...creatorOnly, schema: { response: { 200: CreatorLimitsSchema } } },
      (request) => asCreator(() => store.mine(signedIn(request.user).id, clock())),
    );

    app.post(
      '/creator-space/absences',
      { ...creatorOnly, schema: { body: NewAbsenceBodySchema, response: { 201: CreatorAbsenceSchema } } },
      async (request, reply) => {
        const absence = await asCreator(() =>
          store.tellAbsence(signedIn(request.user).id, request.body, clock()),
        );
        return reply.code(201).send(absence);
      },
    );

    app.post(
      '/creator-space/absences/:id/cancel',
      { ...creatorOnly, schema: { params: LimitParamsSchema } },
      async (request, reply) => {
        await asCreator(() => store.cancelAbsence(signedIn(request.user).id, request.params.id));
        return reply.code(204).send();
      },
    );

    app.post(
      '/creator-space/stops',
      { ...creatorOnly, schema: { body: NewStopBodySchema, response: { 201: CreatorStopSchema } } },
      async (request, reply) => {
        const stop = await asCreator(() => store.tellStop(signedIn(request.user).id, request.body));
        return reply.code(201).send(stop);
      },
    );

    app.post(
      '/creator-space/stops/:id/withdraw',
      { ...creatorOnly, schema: { params: LimitParamsSchema } },
      async (request, reply) => {
        await asCreator(() => store.withdrawStop(signedIn(request.user).id, request.params.id));
        return reply.code(204).send();
      },
    );

    app.get(
      '/creators/:creatorId/limits',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: { params: CreatorParamsSchema, response: { 200: CreatorLimitsSchema } },
      },
      (request) => {
        const { creatorId } = request.params;
        if (!readsLimits(signedIn(request.user), creatorId)) throw new LimitsForbidden();
        return store.ofCreator(creatorId, clock());
      },
    );

    return Promise.resolve();
  };
}
