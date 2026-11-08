import {
  CopilotDraftQuerySchema,
  CopilotDraftViewSchema,
  CopilotVerdictBodySchema,
  CopilotVerdictResultSchema,
  CreatorIdSchema,
  DomainError,
  DraftIdSchema,
  ExtensionLinkTokenSchema,
  PlatformConversationIdSchema,
  UserIdSchema,
  type CopilotDraftView,
  type CreatorId,
  type CurrentUser,
} from '@impera/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { recordCopilotGesture, type CopilotGestureDeps } from '../../application/copilot';
import {
  CopilotCreatorConflict,
  CopilotForbidden,
  CopilotLinkUnauthenticated,
  CopilotOffShift,
} from '../../domain/errors';
import type { CopilotRead, CopilotReader } from '../../domain/ports';

import type { RequireRole } from './routes';

/** The person an extension link names, read as a session would read him; `null` for a link that names nobody. */
type LinkUser = (token: string) => Promise<CurrentUser | null>;

export interface CopilotRouteDeps {
  readonly reader: CopilotReader;
  readonly gestures: CopilotGestureDeps;
  readonly requireRole: RequireRole;
  readonly linkUser: LinkUser;
  /** Every creator not archived: where the owner's panel looks for the conversation open on the platform. */
  readonly allCreatorIds: () => Promise<readonly CreatorId[]>;
}

class CreatorForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Créatrice hors de ton périmètre');
  }
}

/** The panel reads every 5 s and a gesture is rare: 120 reads a minute, 30 gestures, a wrong token counted. */
const READ_LIMIT = { max: 120, timeWindow: '1 minute', skipOnError: false };
const GESTURE_LIMIT = { max: 30, timeWindow: '1 minute', skipOnError: false };

const LinkHeadersSchema = z.looseObject({ 'x-extension-link': z.string().optional() });

/** The owner and an active manager read her whole (`creatorIds`); a chatter, only on shift on her (ADR 0086 § 7). */
const readsWhole = (user: CurrentUser, creatorId: CreatorId): boolean =>
  user.role === 'owner' || user.creatorIds.includes(creatorId);

const onShift = (user: CurrentUser, creatorId: CreatorId): boolean =>
  readsWhole(user, creatorId) || user.shiftCreatorIds.includes(creatorId);

/** One of his creators at all: his own list, or those routed to him (ADR 0024); anyone else's is 403 at once. */
const isHis = (user: CurrentUser, creatorId: CreatorId): boolean =>
  readsWhole(user, creatorId) || user.routedCreatorIds.includes(creatorId);

/** Who may open the panel on her: the agency only, the chatter on shift on her (§ 7). */
function assertCopilot(user: CurrentUser, creatorId: CreatorId): void {
  if (user.role !== 'owner' && user.role !== 'operator') throw new CopilotForbidden();
  if (!isHis(user, creatorId)) throw new CreatorForbidden();
  if (!onShift(user, creatorId)) throw new CopilotOffShift();
}

function viewOf(creatorId: CreatorId, read: CopilotRead): CopilotDraftView {
  const conversation = {
    creatorId,
    conversationId: read.conversationId,
    fanId: read.fanId,
    switches: read.switches,
  };
  if (!read.switches.drafts) return { state: 'off', conversation };
  if (read.draft !== null)
    return {
      state: 'ready',
      conversation,
      draft: {
        draftId: read.draft.id,
        bubbles: [...read.draft.bubbles],
        createdAt: read.draft.createdAt.toISOString(),
        placedAt: read.draft.placedAt?.toISOString() ?? null,
      },
    };
  return { state: read.writing ? 'writing' : 'none', conversation };
}

/**
 * `/v1/copilot` (ADR 0086): the extension's side panel. It reads with the dashboard's session (ADR 0066 § 2) and writes
 * with the person's extension link (§ 7), never the cookie. Nothing here writes to the platform: the chatter sends
 * himself, and what left is reconciled with the draft (§ 5, `agent` thread).
 */
export function createCopilotRoutes(deps: CopilotRouteDeps): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/copilot/conversations/:platformConversationId/draft',
      {
        preValidation: deps.requireRole('owner', 'operator'),
        config: { rateLimit: READ_LIMIT },
        schema: {
          params: z.object({ platformConversationId: PlatformConversationIdSchema }),
          querystring: CopilotDraftQuerySchema,
          response: { 200: CopilotDraftViewSchema },
        },
      },
      async (request) => {
        const user = request.user;
        if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
        const { platform, creatorId } = request.query;
        const conversation = { platform, platformConversationId: request.params.platformConversationId };
        if (creatorId !== undefined && !isHis(user, creatorId)) throw new CreatorForbidden();
        const candidates =
          creatorId !== undefined
            ? [creatorId]
            : user.role === 'owner'
              ? await deps.allCreatorIds()
              : [...new Set([...user.creatorIds, ...user.routedCreatorIds])].map((id) =>
                  CreatorIdSchema.parse(id),
                );
        const found: { creatorId: CreatorId; read: CopilotRead }[] = [];
        for (const candidate of candidates) {
          const read = await deps.reader.read(candidate, conversation);
          if (read !== null) found.push({ creatorId: candidate, read });
        }
        const [match, other] = found;
        if (match === undefined) return { state: 'unknown' as const };
        if (other !== undefined) throw new CopilotCreatorConflict();
        assertCopilot(user, match.creatorId);
        if (readsWhole(user, match.creatorId)) return viewOf(match.creatorId, match.read);
        // A chatter's opening goes to the audit log before he reads anything (§ 7), at most once per 15 minutes.
        const traced = await deps.reader.read(match.creatorId, conversation, {
          userId: UserIdSchema.parse(user.id),
          ip: request.ip,
        });
        return traced === null ? { state: 'unknown' as const } : viewOf(match.creatorId, traced);
      },
    );

    /** The person each gesture names, read from its `x-extension-link` before the body is. */
    const linked = new WeakMap<FastifyRequest, CurrentUser>();

    app.post(
      '/copilot/drafts/:draftId/verdict',
      {
        // Its secret is in a header: nothing below `warn` is logged, and the extension has its own origin.
        logLevel: 'warn',
        config: { originCheck: false, rateLimit: GESTURE_LIMIT },
        preParsing: async (request, _reply, payload) => {
          const token = ExtensionLinkTokenSchema.safeParse(request.headers['x-extension-link']);
          const user = token.success ? await deps.linkUser(token.data) : null;
          if (user === null) throw new CopilotLinkUnauthenticated();
          linked.set(request, user);
          return payload;
        },
        schema: {
          headers: LinkHeadersSchema,
          params: z.object({ draftId: DraftIdSchema }),
          body: CopilotVerdictBodySchema,
          response: { 200: CopilotVerdictResultSchema },
        },
      },
      async (request) => {
        const user = linked.get(request);
        if (user === undefined) throw new CopilotLinkUnauthenticated();
        const { body } = request;
        assertCopilot(user, body.creatorId);
        return recordCopilotGesture(deps.gestures, {
          creatorId: body.creatorId,
          draftId: request.params.draftId,
          userId: UserIdSchema.parse(user.id),
          body,
          correlationId: request.id,
        });
      },
    );
    return Promise.resolve();
  };
}
