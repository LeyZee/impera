import { DomainError, FanListPageSchema, FanListQuerySchema, UserIdSchema } from '@impera/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { FanListReader } from '../fan-list-reader';

import type { RequireRole } from './flag-routes';

class CreatorForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Créatrice hors de ton périmètre');
  }
}

/**
 * `GET /v1/fans?creatorId=…` (ADR 0124): every fan the CRM knows for her, for the owner and an active manager of her
 * list (§ 4), as `GET /dashboard/agency` allows it. A chatter, a manager who is not active and a creator get a 403:
 * the list is never theirs (0043 § 7, 0063). Read only (§ 6).
 */
export function createListRoutes(
  reader: FanListReader,
  requireRole: RequireRole,
  now: () => Date = () => new Date(),
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/fans',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: { querystring: FanListQuerySchema, response: { 200: FanListPageSchema } },
      },
      async (request) => {
        const { user } = request;
        if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
        const { creatorId } = request.query;
        if (user.role !== 'owner' && !user.creatorIds.includes(creatorId)) throw new CreatorForbidden();
        const page = await reader.read(creatorId, UserIdSchema.parse(user.id), request.query, now());
        if (page === null) throw new CreatorForbidden();
        return page;
      },
    );
    return Promise.resolve();
  };
}
