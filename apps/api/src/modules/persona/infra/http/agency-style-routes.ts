import {
  ActivateAgencyStyleBodySchema,
  ActivateAgencyStyleParamsSchema,
  AgencyStyleOverviewSchema,
  AgencyStyleVersionSchema,
  DomainError,
  SaveAgencyStyleBodySchema,
  type CurrentUser,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { AgencyStyleStore } from '../../domain/agency-style';

import type { RequireRole } from './routes';

/** The signed-in owner (`requireRole('owner')` ran before). */
function ownerOf(request: FastifyRequest): CurrentUser {
  const { user } = request;
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return user;
}

/**
 * `/v1/agency/style` (ADR 0171): the agency's base style, the owner's alone. `GET` reads the active version and the
 * latest ones; `PUT` saves a new version, never active; `POST …/versions/:versionId/activate` makes it the one the agent
 * writes with, with a recent sign-in, as her persona's activation (it changes what the agent writes to every fan).
 */
export function createAgencyStyleRoutes(
  store: AgencyStyleStore,
  requireRole: RequireRole,
  recentLogin: preValidationAsyncHookHandler,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/agency/style',
      {
        preValidation: requireRole('owner'),
        schema: { response: { 200: AgencyStyleOverviewSchema } },
      },
      async (request) => store.overview(ownerOf(request).id),
    );

    app.put(
      '/agency/style',
      {
        preValidation: requireRole('owner'),
        schema: { body: SaveAgencyStyleBodySchema, response: { 201: AgencyStyleVersionSchema } },
      },
      async (request, reply) => reply.code(201).send(await store.save(request.body, ownerOf(request).id)),
    );

    app.post(
      '/agency/style/versions/:versionId/activate',
      {
        preValidation: [requireRole('owner'), recentLogin],
        schema: {
          params: ActivateAgencyStyleParamsSchema,
          body: ActivateAgencyStyleBodySchema,
          response: { 200: AgencyStyleVersionSchema },
        },
      },
      async (request) =>
        store.activate(request.params.versionId, request.body.expectedActive, ownerOf(request).id),
    );
    return Promise.resolve();
  };
}
