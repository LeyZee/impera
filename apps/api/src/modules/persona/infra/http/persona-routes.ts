import {
  ActivatePersonaVersionBodySchema,
  ActivatePersonaVersionParamsSchema,
  ChatterPersonaSchema,
  CreatePersonaVersionBodySchema,
  CreatorIdSchema,
  DomainError,
  MyPersonaSchema,
  PersonaCorrectionListSchema,
  PersonaCorrectionParamsSchema,
  PersonaCorrectionSchema,
  PersonaOverviewSchema,
  PersonaVersionSummarySchema,
  ProposePersonaCorrectionBodySchema,
  type CreatorId,
  type CurrentUser,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { PersonaCorrectionStore } from '../../domain/corrections';
import { withoutObjectionReplies } from '../../domain/redact';
import { answersOf, chatterSheetOf, sheetOf } from '../../domain/sheet';
import type { PersonaVersionStore } from '../../domain/versions';

import type { RequireRole } from './routes';

class CreatorForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Créatrice hors de ton périmètre');
  }
}

/** A chatter of hers outside his shift and its margin (ADR 0025): her sheet waits for his next shift (ADR 0153). */
class PersonaOffShift extends DomainError {
  constructor() {
    super('persona_shift_forbidden', 'Tu n’es pas en poste sur cette créatrice.');
  }
}

const CreatorParamsSchema = z.object({ creatorId: CreatorIdSchema });

/**
 * Who reads her sheet as a chatter does (ADR 0153): the owner and a member whose list holds her, untraced; a member
 * whose scope is `self` only while his shift window is open on her (`shiftCreatorIds`, ADR 0025), traced.
 */
function chatterReaderFor(
  request: FastifyRequest,
  creatorId: CreatorId,
): { userId: string; traced: boolean } {
  const { user } = request;
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  if (user.role === 'owner' || user.creatorIds.includes(creatorId)) return { userId: user.id, traced: false };
  if (user.shiftCreatorIds.includes(creatorId)) return { userId: user.id, traced: true };
  if (user.routedCreatorIds.includes(creatorId)) throw new PersonaOffShift();
  throw new CreatorForbidden();
}

/** Today's date in UTC: her age to the day, never her birth date (ADR 0153). */
const isoToday = (now: Date): string => now.toISOString().slice(0, 10);

/** The signed-in user, allowed on this creator: an owner sees every creator, anyone else their own list. */
function actorFor(request: FastifyRequest, creatorId: CreatorId): CurrentUser {
  const { user } = request;
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  if (user.role !== 'owner' && !user.creatorIds.includes(creatorId)) throw new CreatorForbidden();
  return user;
}

/**
 * `/v1/creators/:creatorId/persona` (ADR 0010): the dashboard reads her versions, stores a new one (never active),
 * and activates one, an audited event.
 */
export function createPersonaRoutes(
  store: PersonaVersionStore,
  corrections: PersonaCorrectionStore,
  requireRole: RequireRole,
  recentLogin: preValidationAsyncHookHandler,
  now: () => Date = () => new Date(),
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/creators/:creatorId/persona',
      {
        // The agency's sheet, its strategies and its history: never the creator's (recette CREA-01), who reads hers
        // at `…/persona/mine`.
        preValidation: requireRole('owner', 'operator'),
        schema: { params: CreatorParamsSchema, response: { 200: PersonaOverviewSchema } },
      },
      async (request) => {
        const { creatorId } = request.params;
        const user = actorFor(request, creatorId);
        const overview = await store.overview(creatorId);
        return user.role === 'owner' ? overview : withoutObjectionReplies(overview);
      },
    );

    app.get(
      '/creators/:creatorId/persona/mine',
      {
        preValidation: requireRole('creator'),
        schema: { params: CreatorParamsSchema, response: { 200: MyPersonaSchema } },
      },
      async (request) => {
        const { creatorId } = request.params;
        actorFor(request, creatorId);
        const active = await store.active(creatorId);
        if (active === null) return { creatorId, sheet: null, answers: null };
        return { creatorId, sheet: sheetOf(active.persona), answers: answersOf(active.persona) };
      },
    );

    app.get(
      '/creators/:creatorId/persona/chatter',
      {
        // The short sheet a chatter reads on shift (ADR 0153): who she is, how she writes, what she never does.
        preValidation: requireRole('owner', 'operator'),
        schema: { params: CreatorParamsSchema, response: { 200: ChatterPersonaSchema } },
      },
      async (request) => {
        const { creatorId } = request.params;
        const reader = chatterReaderFor(request, creatorId);
        // Written before anything is read, as for a conversation he opens (ADR 0025).
        if (reader.traced) await store.traceChatterOpening(creatorId, reader.userId, request.ip);
        const active = await store.active(creatorId);
        return { creatorId, sheet: active === null ? null : chatterSheetOf(active.persona, isoToday(now())) };
      },
    );

    app.post(
      '/creators/:creatorId/persona/versions',
      {
        // Only the owner changes it: the creator reads her sheet and proposes, the agency writes (recette CREA-01,
        // Charles 05/11).
        preValidation: requireRole('owner'),
        schema: {
          params: CreatorParamsSchema,
          body: CreatePersonaVersionBodySchema,
          response: { 201: PersonaVersionSummarySchema },
        },
      },
      async (request, reply) => {
        const { creatorId } = request.params;
        const user = actorFor(request, creatorId);
        const created = await store.create(creatorId, request.body, user.id);
        return reply.code(201).send(created);
      },
    );

    app.post(
      '/creators/:creatorId/persona/versions/:versionId/activate',
      {
        // The one in force: the owner, who alone changes her persona, chooses it. It changes what the agent
        // says of her to every fan, so a sign-in of less than 10 minutes is asked, as for her hours (audit de
        // sécurité du 02/11, M1): a stolen session or a laptop left open is not enough.
        preValidation: [requireRole('owner'), recentLogin],
        schema: {
          params: ActivatePersonaVersionParamsSchema,
          body: ActivatePersonaVersionBodySchema,
          response: { 200: PersonaVersionSummarySchema },
        },
      },
      async (request) => {
        const { creatorId, versionId } = request.params;
        const user = actorFor(request, creatorId);
        return store.activate(creatorId, versionId, request.body.expectedActive, user.id);
      },
    );

    app.get(
      '/creators/:creatorId/persona/corrections',
      {
        // Hers to her; to the owner and an active manager, on her persona (a chatter, closed by her policies or by his list, reads none).
        preValidation: requireRole('owner', 'operator', 'creator'),
        schema: { params: CreatorParamsSchema, response: { 200: PersonaCorrectionListSchema } },
      },
      async (request) => {
        const { creatorId } = request.params;
        const user = actorFor(request, creatorId);
        const list =
          user.role === 'creator'
            ? await corrections.mine(user.id)
            : await corrections.list(creatorId, user.id);
        return { corrections: [...list] };
      },
    );

    app.post(
      '/creators/:creatorId/persona/corrections',
      {
        // She reads her sheet and proposes, the agency changes it (recette CREA-01 b, Charles 05/11 « go recos »).
        preValidation: requireRole('creator'),
        schema: {
          params: CreatorParamsSchema,
          body: ProposePersonaCorrectionBodySchema,
          response: { 201: PersonaCorrectionSchema },
        },
      },
      async (request, reply) => {
        const user = actorFor(request, request.params.creatorId);
        return reply.code(201).send(await corrections.propose(user.id, request.body));
      },
    );

    app.post(
      '/creators/:creatorId/persona/corrections/:correctionId/done',
      {
        // The owner, who alone changes her persona, says he handled it.
        preValidation: requireRole('owner'),
        schema: { params: PersonaCorrectionParamsSchema, response: { 200: PersonaCorrectionSchema } },
      },
      async (request) => {
        const { creatorId, correctionId } = request.params;
        const user = actorFor(request, creatorId);
        return corrections.markDone(creatorId, correctionId, user.id);
      },
    );
    return Promise.resolve();
  };
}
