import {
  AgentHourExceptionParamsSchema,
  AgentHourExceptionsViewSchema,
  CreatorIdSchema,
  DomainError,
  SetAgentHourExceptionBodySchema,
  type CreatorErrorCode,
} from '@impera/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AgentHourExceptions } from '../../domain/ports';

import type { RequireRole } from './routes';

const CreatorParamsSchema = z.object({ id: CreatorIdSchema });

class CreatorNotFound extends DomainError {
  constructor() {
    super('creator_not_found' satisfies CreatorErrorCode, 'Créatrice introuvable');
  }
}

/**
 * `/creators/:id/agent-hours/exceptions` (ADR 0148 § 3): her dated exceptions, the owner's alone like her hours; a
 * change asks a recent sign-in, as `PUT /creators/:id/agent-hours` does. `PUT …/:date` writes the ranges of that date
 * (none: no agent that day), `DELETE …/:date` gives it back to her week type.
 */
export function createAgentHourExceptionRoutes(
  exceptions: AgentHourExceptions,
  requireRole: RequireRole,
  recentLogin: preValidationAsyncHookHandler,
): FastifyPluginAsyncZod {
  return (app) => {
    const signedIn = (user: { id: string } | null): string => {
      if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
      return user.id;
    };

    app.get(
      '/creators/:id/agent-hours/exceptions',
      {
        preValidation: requireRole('owner'),
        schema: { params: CreatorParamsSchema, response: { 200: AgentHourExceptionsViewSchema } },
      },
      async (request) => {
        const view = await exceptions.list(request.params.id);
        if (view === null) throw new CreatorNotFound();
        return view;
      },
    );

    app.put(
      '/creators/:id/agent-hours/exceptions/:date',
      {
        preValidation: [requireRole('owner'), recentLogin],
        schema: {
          params: AgentHourExceptionParamsSchema,
          body: SetAgentHourExceptionBodySchema,
          response: { 200: AgentHourExceptionsViewSchema },
        },
      },
      async (request) => {
        const userId = signedIn(request.user);
        const { id, date } = request.params;
        const view = await exceptions.set(id, date, request.body.ranges, userId);
        if (view === null) throw new CreatorNotFound();
        return view;
      },
    );

    app.delete(
      '/creators/:id/agent-hours/exceptions/:date',
      {
        preValidation: [requireRole('owner'), recentLogin],
        schema: { params: AgentHourExceptionParamsSchema, response: { 200: AgentHourExceptionsViewSchema } },
      },
      async (request) => {
        const userId = signedIn(request.user);
        const { id, date } = request.params;
        const view = await exceptions.remove(id, date, userId);
        if (view === null) throw new CreatorNotFound();
        return view;
      },
    );

    return Promise.resolve();
  };
}
