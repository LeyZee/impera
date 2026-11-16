import {
  AgencyRedirectLinkSchema,
  AgencyRedirectLinksResponseSchema,
  AgencyRedirectLinkWriteSchema,
  creatorLinkCards,
  CreatorIdSchema,
  CreatorLinksResponseSchema,
  DomainError,
  RedirectLinkIdSchema,
  UserIdSchema,
  type UserRole,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { RedirectLinkActor, RedirectLinkStore } from '../../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

function actorOf(request: FastifyRequest): RedirectLinkActor {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return { userId: UserIdSchema.parse(request.user.id), ip: request.ip };
}

const CreatorParams = z.object({ creatorId: CreatorIdSchema });
const LinkParams = CreatorParams.extend({ linkId: RedirectLinkIdSchema });

/**
 * Her redirect links (INS-03, ADR 0121 § 1). The owner and an active manager read and set them for a creator; she
 * reads « Mes liens », her own links that are on and placed, as cards without a figure. The store reads each
 * person's right again in the base; no route here opens a connection outward.
 */
export function createRedirectLinkRoutes(
  store: RedirectLinkStore,
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  return (app) => {
    const agency = { preValidation: requireRole('owner', 'operator') };

    app.get(
      '/creators/:creatorId/redirect-links',
      { ...agency, schema: { params: CreatorParams, response: { 200: AgencyRedirectLinksResponseSchema } } },
      async (request) => ({
        links: [...(await store.listForAgency(actorOf(request), request.params.creatorId))],
      }),
    );

    app.post(
      '/creators/:creatorId/redirect-links',
      {
        ...agency,
        schema: {
          params: CreatorParams,
          body: AgencyRedirectLinkWriteSchema,
          response: { 200: AgencyRedirectLinkSchema },
        },
      },
      (request) => store.create(actorOf(request), request.params.creatorId, request.body),
    );

    app.put(
      '/creators/:creatorId/redirect-links/:linkId',
      {
        ...agency,
        schema: {
          params: LinkParams,
          body: AgencyRedirectLinkWriteSchema,
          response: { 200: AgencyRedirectLinkSchema },
        },
      },
      (request) =>
        store.update(actorOf(request), request.params.creatorId, request.params.linkId, request.body),
    );

    app.get(
      '/creator-space/links',
      { preValidation: requireRole('creator'), schema: { response: { 200: CreatorLinksResponseSchema } } },
      async (request) => ({ links: creatorLinkCards(await store.listOwn(actorOf(request).userId)) }),
    );

    return Promise.resolve();
  };
}
