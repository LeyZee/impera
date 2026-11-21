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
import { RedirectLinkError } from '../../domain/errors';
import { serviceLinkOf } from '../../domain/links';
import type { DetectLinks, RedirectLinkActor, RedirectLinkStore } from '../../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

function actorOf(request: FastifyRequest): RedirectLinkActor {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return { userId: UserIdSchema.parse(request.user.id), ip: request.ip };
}

/**
 * A detection reads up to twenty pages at the service: a few a minute is a person's pace. A bound of its own: the shared
 * store names a `createRateLimit` limiter by its bounds and refuses two of the same (`rate-limit-store.ts`).
 */
const DETECTIONS_PER_MINUTE = 6;
/** An attachment reads the service as a detection does; a bound of its own, for the same reason. */
const ATTACHMENTS_PER_MINUTE = 8;

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
    const ownerLimit = (name: string, max: number): preValidationAsyncHookHandler => {
      const limit = app.createRateLimit({
        max,
        timeWindow: '1 minute',
        keyGenerator: (request) =>
          `redirect-links:${name}:${request.user?.id ?? ''}:${limitKeyOf(request.ip)}`,
      });
      return async (request, reply) => {
        const attempt = await limit(request);
        if (attempt.isAllowed || !attempt.isExceeded) return;
        void reply.header('retry-after', attempt.ttlInSeconds);
        throw new OwnerLimitReached();
      };
    };
    const detections = ownerLimit('detect', DETECTIONS_PER_MINUTE);
    const attachments = ownerLimit('attach', ATTACHMENTS_PER_MINUTE);

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

    /**
     * « Relier ce lien » (INS-02 lot e2, ADR 0120 § 3): the owner attaches a link of hers to its link at the redirect
     * service, so that its hours are read. Nothing in the request names the service's link: the server reads the
     * account now and keeps the reference of the one link that has exactly this address. No such link: refused,
     * nothing written.
     */
    app.post(
      '/creators/:creatorId/redirect-links/:linkId/attach',
      {
        preValidation: [requireRole('owner'), attachments],
        schema: {
          params: LinkParams,
          response: { 200: AgencyRedirectLinkSchema, 422: LinkServiceRefusalBodySchema },
        },
      },
      async (request) => {
        const actor = actorOf(request);
        const { creatorId, linkId } = request.params;
        // Her links first: a creator the owner cannot read is refused before anything is asked outside.
        const link = (await store.listForAgency(actor, creatorId)).find((one) => one.id === linkId);
        if (link === undefined) throw new RedirectLinkError('link_not_found');
        const detected = await detectLinks();
        if (!detected.ok) throw new RefusalError(LINK_SERVICE_UNPROCESSABLE, detected.error);
        const found = serviceLinkOf(link, detected.links);
        if (found === null) throw new RedirectLinkError('not_at_service');
        return store.attach(actor, creatorId, linkId, link.url, found.ref);
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
