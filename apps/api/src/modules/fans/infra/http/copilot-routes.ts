import {
  CopilotFanCardFieldSchema,
  CopilotFanNoteBodySchema,
  CopilotFanNoteSchema,
  CreatorIdSchema,
  DomainError,
  EXTENSION_LINK_ROUTES,
  ExtensionLinkTokenSchema,
  FanCardFieldSchema,
  FanIdSchema,
  SetFanCardFieldBodySchema,
  type CreatorId,
  type CurrentUser,
  type ExtensionLinkRoute,
  type ExtensionLinkScope,
} from '@impera/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { FansService } from '../../application/fans';

import { cardView } from './card-routes';
import { noFanAccess, readerOf, type FanAccess } from './flag-routes';

/** The person a link names, read as a session would read him, and what the link allows (ADR 0109). */
export type LinkPerson = (
  token: string,
) => Promise<{ readonly user: CurrentUser; readonly scopes: readonly ExtensionLinkScope[] } | null>;

class LinkUnauthenticated extends DomainError {
  constructor() {
    super('extension_link_unauthenticated', 'Extension non reliée : relie-la depuis le CRM');
  }
}

/** A link made before ADR 0109, or for a creator: it does not write in a fan's card (§ 5). */
class LinkScopeForbidden extends DomainError {
  constructor() {
    super(
      'extension_link_scope_forbidden',
      'Relie l’extension à nouveau depuis le CRM pour écrire sur le fan',
    );
  }
}

class CopilotForbidden extends DomainError {
  constructor() {
    super('copilot_forbidden', 'Le panneau copilote est réservé à l’agence');
  }
}

class CopilotOffShift extends DomainError {
  constructor() {
    super('copilot_shift_forbidden', 'Tu n’es pas en poste sur cette créatrice.');
  }
}

/** A gesture is rare: 30 a minute per address, a wrong token counted, as the verdict's. */
const GESTURE_LIMIT = { max: 30, timeWindow: '1 minute', skipOnError: false };

const LinkHeadersSchema = z.looseObject({ 'x-extension-link': z.string().optional() });
const CreatorQuerySchema = z.object({ creatorId: CreatorIdSchema });

/**
 * § 3: only on shift, on the creators of the shift (`shiftCreatorIds`, its margin included); the owner and an active
 * manager who reads her whole are not bounded by a shift. Out of it, a conversation he still holds opens nothing here.
 */
function assertOnShift(user: CurrentUser, creatorId: CreatorId): void {
  if (user.role !== 'owner' && user.role !== 'operator') throw new CopilotForbidden();
  if (user.role === 'owner' || user.creatorIds.includes(creatorId)) return;
  if (!user.shiftCreatorIds.includes(creatorId)) throw new CopilotOffShift();
}

/**
 * `/v1/copilot/fans` (ADR 0109 and its amendment of 21/11): the two writes on a fan the extension's panel may make, a
 * field of his card and a note, sisters of the CRM's. Each reads the person's link alone (`x-extension-link`, never the
 * cookie), asks the scope `EXTENSION_LINK_ROUTES` gives it, the shift (§ 3), then the CRM's own right on the fan
 * (`readerOf`, the function `PUT /v1/fans/:id/card/:field` uses), and answers what it wrote alone. Each write is in the
 * audit log with `via: 'extension'`, never its value (§ 6).
 */
export function createCopilotFanRoutes(
  fans: FansService,
  linkPerson: LinkPerson,
  access: FanAccess = noFanAccess,
): FastifyPluginAsyncZod {
  return (app) => {
    const linked = new WeakMap<FastifyRequest, CurrentUser>();
    /** The link read before the body (401 before any 400), with the scope its route asks. */
    const door = (route: ExtensionLinkRoute) => ({
      // Its secret is in a header: nothing below `warn` is logged, and the extension has its own origin.
      logLevel: 'warn' as const,
      config: { originCheck: false, extensionLink: true, rateLimit: GESTURE_LIMIT },
      preParsing: async (request: FastifyRequest, _reply: unknown, payload: unknown) => {
        const token = ExtensionLinkTokenSchema.safeParse(request.headers['x-extension-link']);
        const person = token.success ? await linkPerson(token.data) : null;
        if (person === null) throw new LinkUnauthenticated();
        const scope = EXTENSION_LINK_ROUTES[route];
        if (scope !== null && !person.scopes.includes(scope)) throw new LinkScopeForbidden();
        linked.set(request, person.user);
        return payload;
      },
    });
    const userOf = (request: FastifyRequest): CurrentUser => {
      const user = linked.get(request);
      if (user === undefined) throw new LinkUnauthenticated();
      return user;
    };

    app.put(
      '/copilot/fans/:id/card/:field',
      {
        ...door('PUT /v1/copilot/fans/:id/card/:field'),
        schema: {
          headers: LinkHeadersSchema,
          params: z.object({ id: FanIdSchema, field: FanCardFieldSchema }),
          querystring: CreatorQuerySchema,
          body: SetFanCardFieldBodySchema,
          response: { 200: CopilotFanCardFieldSchema },
        },
      },
      async (request) => {
        const user = userOf(request);
        const { creatorId } = request.query;
        const { id: fanId, field } = request.params;
        assertOnShift(user, creatorId);
        const author = await readerOf(user, request.ip, creatorId, fanId, access, 'card');
        const card = await fans.editCard(creatorId, fanId, field, request.body, author, {
          userId: author,
          ip: request.ip,
          action: 'fan_card.edit',
          field,
        });
        // The field written alone, its quotes read as the card reads them: nothing else of the fan.
        const view = await cardView(access, creatorId, fanId, card);
        const entry = view.fields.find((candidate) => candidate.field === field);
        if (entry === undefined) throw new Error(`fan card without its field ${field}`);
        return entry;
      },
    );

    app.post(
      '/copilot/fans/:id/notes',
      {
        ...door('POST /v1/copilot/fans/:id/notes'),
        schema: {
          headers: LinkHeadersSchema,
          params: z.object({ id: FanIdSchema }),
          querystring: CreatorQuerySchema,
          body: CopilotFanNoteBodySchema,
          response: { 201: CopilotFanNoteSchema },
        },
      },
      async (request, reply) => {
        const user = userOf(request);
        const { creatorId } = request.query;
        const fanId = request.params.id;
        assertOnShift(user, creatorId);
        const author = await readerOf(user, request.ip, creatorId, fanId, access, 'card');
        const note = await fans.addNote(creatorId, fanId, request.body.note, {
          userId: author,
          ip: request.ip,
          action: 'fan_note.create',
        });
        if (note === null) throw new Error('fan note not written');
        return reply.code(201).send({
          key: note.key,
          value: note.value,
          source: 'noted' as const,
          observedAt: note.observedAt.toISOString(),
        });
      },
    );
    return Promise.resolve();
  };
}
