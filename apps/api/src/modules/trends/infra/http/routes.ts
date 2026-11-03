import {
  CreateExtensionLinkBodySchema,
  DomainError,
  ExtensionLinkCreatedSchema,
  ExtensionLinkCreatorsSchema,
  ExtensionLinkIdSchema,
  ExtensionLinkListSchema,
  ExtensionLinkTokenSchema,
  PastedTrendLinkSchema,
  PasteTrendLinkBodySchema,
  TREND_CAPTURE_MAX_BYTES,
  TREND_CAPTURES_MAX,
  TrendCapturesBodySchema,
  TrendCapturesDescribedSchema,
  TrendReadingsAcceptedSchema,
  TrendReadingsBatchSchema,
  UserIdSchema,
  type UserRole,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { describeCaptures } from '../../application/captures';
import { pasteLink } from '../../application/links';
import {
  ExtensionLinkForbidden,
  ExtensionLinkNotFound,
  ExtensionLinksFull,
  ExtensionLinkUnauthenticated,
} from '../../domain/errors';
import type {
  CaptureVision,
  ExtensionLinkStore,
  LinkHolder,
  ReadingStore,
  SignalStore,
  TrendActor,
} from '../../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

/** 30 calls a minute at most per address on the extension's doors, a wrong token counted: a batch is sent when a watch session pauses or ends. */
const READINGS_LIMIT = { max: 30, timeWindow: '1 minute', skipOnError: false };

/** Four captures in base64 (4/3 of their bytes) and the JSON around them: the server's 1 MiB would refuse them. */
const CAPTURES_BODY_LIMIT = Math.ceil((TREND_CAPTURES_MAX * TREND_CAPTURE_MAX_BYTES * 4) / 3) + 16_384;

const LinkHeadersSchema = z.looseObject({ 'x-extension-link': z.string().optional() });

function actorOf(request: FastifyRequest): TrendActor {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return { userId: UserIdSchema.parse(request.user.id), role: request.user.role, ip: request.ip };
}

/**
 * `/v1/trends` (VEI-01 lot b, ADR 0060 § 2). « Coller un lien » for the owner, a member and a creator; « Relier
 * l'extension », one link per browser, for the same; the readings and the creators one may mark for, asked by the
 * extension with its link and no dashboard session. No route
 * here opens a connection outward: an address is read by its form, a reading is only received.
 */
export function createTrendRoutes(
  stores: {
    readonly signals: SignalStore;
    readonly links: ExtensionLinkStore;
    readonly readings: ReadingStore;
    readonly vision: CaptureVision;
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
      '/trends/extension-links',
      { ...person, schema: { response: { 200: ExtensionLinkListSchema } } },
      async (request) => ({ items: await stores.links.live(actorOf(request).userId) }),
    );

    app.post(
      '/trends/extension-links',
      {
        ...person,
        schema: { body: CreateExtensionLinkBodySchema, response: { 201: ExtensionLinkCreatedSchema } },
      },
      async (request, reply) => {
        const created = await stores.links.create(actorOf(request), request.body.label);
        if (created === null) throw new ExtensionLinkForbidden();
        if (created === 'full') throw new ExtensionLinksFull();
        // Shown once: never kept on the way.
        return reply.code(201).header('cache-control', 'no-store').send(created);
      },
    );

    app.delete(
      '/trends/extension-links/:id',
      { ...person, schema: { params: z.object({ id: ExtensionLinkIdSchema }) } },
      async (request, reply) => {
        if (!(await stores.links.revoke(actorOf(request), request.params.id)))
          throw new ExtensionLinkNotFound();
        return reply.code(204).send();
      },
    );

    // The extension's doors: its link is the key, exempt from the dashboard's Origin check, the extension having its own
    // origin. The link is read in `preParsing`, after the rate limit's `onRequest` (a wrong token counts against the
    // limit) and before the body is parsed (401 before any 400). Its secret is in a header: the routes log nothing
    // below `warn`, and a body (what she watched) is never logged nor echoed.
    const extensionDoor = {
      logLevel: 'warn' as const,
      config: { originCheck: false, rateLimit: READINGS_LIMIT },
      preParsing: async (request: FastifyRequest, _reply: unknown, payload: unknown) => {
        const token = ExtensionLinkTokenSchema.safeParse(request.headers['x-extension-link']);
        // Only a batch counts as its last use: asking for the creators does not.
        const touch = request.method === 'POST';
        const holder = token.success ? await stores.links.holder(token.data, { touch }) : null;
        if (holder === null) throw new ExtensionLinkUnauthenticated();
        holders.set(request, holder);
        return payload;
      },
    };
    const holderOf = (request: FastifyRequest): LinkHolder => {
      const holder = holders.get(request);
      if (holder === undefined) throw new ExtensionLinkUnauthenticated();
      return holder;
    };

    app.get(
      '/trends/readings/creators',
      {
        ...extensionDoor,
        schema: { headers: LinkHeadersSchema, response: { 200: ExtensionLinkCreatorsSchema } },
      },
      async (request) => ({ items: await stores.readings.markable(holderOf(request)) }),
    );

    app.post(
      '/trends/readings',
      {
        ...extensionDoor,
        schema: {
          headers: LinkHeadersSchema,
          body: TrendReadingsBatchSchema,
          response: { 200: TrendReadingsAcceptedSchema },
        },
      },
      async (request) => ({ accepted: await stores.readings.record(holderOf(request), request.body) }),
    );

    // The captures of a marked post: held for the vision call only, never written, logged nor echoed (ADR 0060 § 2).
    app.post(
      '/trends/readings/captures',
      {
        ...extensionDoor,
        bodyLimit: CAPTURES_BODY_LIMIT,
        schema: {
          headers: LinkHeadersSchema,
          body: TrendCapturesBodySchema,
          response: { 200: TrendCapturesDescribedSchema },
        },
      },
      (request) => describeCaptures(stores.readings, stores.vision, holderOf(request), request.body),
    );
    return Promise.resolve();
  };
}
