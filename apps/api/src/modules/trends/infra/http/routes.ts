import {
  DomainError,
  ExtensionLinkCreatedSchema,
  ExtensionLinkStateSchema,
  ExtensionLinkTokenSchema,
  PastedTrendLinkSchema,
  PasteTrendLinkBodySchema,
  TrendReadingsAcceptedSchema,
  TrendReadingsBatchSchema,
  UserIdSchema,
  type UserRole,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { pasteLink } from '../../application/links';
import { ExtensionLinkForbidden, ExtensionLinkUnauthenticated } from '../../domain/errors';
import type {
  ExtensionLinkStore,
  LinkHolder,
  ReadingStore,
  SignalStore,
  TrendActor,
} from '../../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

/** A batch a minute at most per address: the extension sends one when a watch session pauses or ends. */
const READINGS_LIMIT = { max: 30, timeWindow: '1 minute', skipOnError: false };

const LinkHeadersSchema = z.looseObject({ 'x-extension-link': z.string().optional() });

function actorOf(request: FastifyRequest): TrendActor {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return { userId: UserIdSchema.parse(request.user.id), role: request.user.role, ip: request.ip };
}

/**
 * `/v1/trends` (VEI-01 lot b, ADR 0060 § 2). « Coller un lien » for the owner, a member and a creator; « Relier
 * l'extension » for the same; the readings, sent by the extension with its link and no dashboard session. No route
 * here opens a connection outward: an address is read by its form, a reading is only received.
 */
export function createTrendRoutes(
  stores: {
    readonly signals: SignalStore;
    readonly links: ExtensionLinkStore;
    readonly readings: ReadingStore;
  },
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  return (app) => {
    const person = { preValidation: requireRole('owner', 'operator', 'creator') };
    /** The person each batch of readings names, read from its `x-extension-link` before the body is. */
    const holders = new WeakMap<FastifyRequest, LinkHolder>();

    app.post(
      '/trends/links',
      { ...person, schema: { body: PasteTrendLinkBodySchema, response: { 200: PastedTrendLinkSchema } } },
      (request) => pasteLink(stores.signals, actorOf(request), request.body, new Date()),
    );

    app.get(
      '/trends/extension-link',
      { ...person, schema: { response: { 200: ExtensionLinkStateSchema } } },
      async (request) => {
        const live = await stores.links.live(actorOf(request).userId);
        return { link: live === null ? null : { createdAt: live.createdAt.toISOString() } };
      },
    );

    app.post(
      '/trends/extension-link',
      { ...person, schema: { response: { 201: ExtensionLinkCreatedSchema } } },
      async (request, reply) => {
        const created = await stores.links.replace(actorOf(request));
        if (created === null) throw new ExtensionLinkForbidden();
        // Shown once: never kept on the way.
        return reply.code(201).header('cache-control', 'no-store').send(created);
      },
    );

    app.delete('/trends/extension-link', person, async (request, reply) => {
      await stores.links.revoke(actorOf(request));
      return reply.code(204).send();
    });

    // The extension's door: its link is the key, checked first on the raw request (401 before any 400 on the body), and
    // exempt from the dashboard's Origin check, the extension having its own origin. Its secret is in a header: the
    // route logs nothing below `warn`, and the body (what she watched) is never logged nor echoed.
    app.post(
      '/trends/readings',
      {
        logLevel: 'warn',
        config: { originCheck: false, rateLimit: READINGS_LIMIT },
        onRequest: async (request) => {
          const token = ExtensionLinkTokenSchema.safeParse(request.headers['x-extension-link']);
          const holder = token.success ? await stores.links.holder(token.data) : null;
          if (holder === null) throw new ExtensionLinkUnauthenticated();
          holders.set(request, holder);
        },
        schema: {
          headers: LinkHeadersSchema,
          body: TrendReadingsBatchSchema,
          response: { 200: TrendReadingsAcceptedSchema },
        },
      },
      async (request) => {
        const holder = holders.get(request);
        if (holder === undefined) throw new ExtensionLinkUnauthenticated();
        return { accepted: await stores.readings.record(holder, request.body) };
      },
    );
    return Promise.resolve();
  };
}
