import {
  AgencyRedirectLinkSchema,
  AgencyRedirectLinksResponseSchema,
  AgencyRedirectLinkWriteSchema,
  creatorLinkCards,
  CreatorIdSchema,
  CreatorLinksResponseSchema,
  DomainError,
  LINK_SERVICE_UNPROCESSABLE,
  limitKeyOf,
  LinkProposalsResponseSchema,
  LinkServiceRefusalBodySchema,
  RedirectLinkIdSchema,
  RefusalError,
  UserIdSchema,
  type UserRole,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { linkProposals } from '../../domain/detection';
import type { DetectLinks, RedirectLinkActor, RedirectLinkStore } from '../../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

function actorOf(request: FastifyRequest): RedirectLinkActor {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return { userId: UserIdSchema.parse(request.user.id), ip: request.ip };
}

/** A detection reads up to twenty pages at the service: a few a minute is a person's pace. */
const DETECTIONS_PER_MINUTE = 5;

/** The common 429 `rate_limited` (server.ts), as the plugin's own limits answer. */
class OwnerLimitReached extends Error {
  readonly statusCode = 429;

  constructor() {
    super('owner limit reached');
    this.name = 'OwnerLimitReached';
  }
}

const CreatorParams = z.object({ creatorId: CreatorIdSchema });
const LinkParams = CreatorParams.extend({ linkId: RedirectLinkIdSchema });

/**
 * Her redirect links (INS-03, ADR 0121 § 1). The owner and an active manager read them for a creator, the owner alone sets them; she
 * reads « Mes liens », her own links that are on and placed, as cards without a figure. The store reads each
 * person's right again in the base. One route reads outward, « Détecter ses liens », through `connectors`.
 */
export function createRedirectLinkRoutes(
  store: RedirectLinkStore,
  requireRole: RequireRole,
  /** `requireRecentLogin` (ADR 0016): a write needs a sign-in confirmed under 10 minutes ago, as the channel's did. */
  recentLogin: preValidationAsyncHookHandler,
  /** `connectors`' reading of the redirect service. */
  detectLinks: DetectLinks,
): FastifyPluginAsyncZod {
  return (app) => {
    const agency = { preValidation: requireRole('owner', 'operator') };
    // An address decides where her readers land (ADR 0080 § 6): the owner alone, freshly confirmed.
    const write = { preValidation: [requireRole('owner'), recentLogin] };

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
        ...write,
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
        ...write,
        schema: {
          params: LinkParams,
          body: AgencyRedirectLinkWriteSchema,
          response: { 200: AgencyRedirectLinkSchema },
        },
      },
      (request) =>
        store.update(actorOf(request), request.params.creatorId, request.params.linkId, request.body),
    );

    // Counted per owner and address, after the guard: a refused call never spends the owner's quota.
    const limit = app.createRateLimit({
      max: DETECTIONS_PER_MINUTE,
      timeWindow: '1 minute',
      keyGenerator: (request) => `redirect-links:detect:${request.user?.id ?? ''}:${limitKeyOf(request.ip)}`,
    });
    const detections: preValidationAsyncHookHandler = async (request, reply) => {
      const attempt = await limit(request);
      if (attempt.isAllowed || !attempt.isExceeded) return;
      void reply.header('retry-after', attempt.ttlInSeconds);
      throw new OwnerLimitReached();
    };

    /**
     * « Détecter ses liens » (INS-02, ADR 0120 § 3): the links of the agency's account at the redirect service, each
     * with a name and a place proposed. The account is the agency's and its list crosses creators, so the owner
     * alone reads it; a manager never does. Nothing is written: each link is confirmed by the routes above.
     */
    app.post(
      '/creators/:creatorId/redirect-links/detect',
      {
        preValidation: [requireRole('owner'), detections],
        schema: {
          params: CreatorParams,
          response: { 200: LinkProposalsResponseSchema, 422: LinkServiceRefusalBodySchema },
        },
      },
      async (request) => {
        // Her links first: a creator the owner cannot read is refused before anything is asked outside.
        const existing = await store.listForAgency(actorOf(request), request.params.creatorId);
        const detected = await detectLinks();
        if (!detected.ok) throw new RefusalError(LINK_SERVICE_UNPROCESSABLE, detected.error);
        return { proposals: linkProposals(detected.links, existing) };
      },
    );

    app.get(
      '/creator-space/links',
      { preValidation: requireRole('creator'), schema: { response: { 200: CreatorLinksResponseSchema } } },
      async (request) => ({ links: creatorLinkCards(await store.listOwn(actorOf(request).userId)) }),
    );

    return Promise.resolve();
  };
}
