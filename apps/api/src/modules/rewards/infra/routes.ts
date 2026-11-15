import {
  CreatorIdSchema,
  MarkRevealedBodySchema,
  TrophyCaseSchema,
  type MarkRevealedBody,
  type TrophyCase,
} from '@impera/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export interface RewardsRoutesOptions {
  /** `requireRole('operator')`: the chatter's game is the team's; the owner has no case here. */
  readonly guard: preValidationAsyncHookHandler;
  /** `requireRole('creator')`: her own case (ADR 0107 § 10). */
  readonly creatorGuard: preValidationAsyncHookHandler;
  /**
   * `requireRole('owner', 'operator')`: her case on her profile, for a creator of the session's list; the store then
   * lets the owner and active managers only.
   */
  readonly agencyGuard: preValidationAsyncHookHandler;
}

export interface RewardsRoutesApi {
  readonly myTrophyCase: (userId: string) => Promise<TrophyCase>;
  readonly markRevealed: (userId: string, body: MarkRevealedBody) => Promise<TrophyCase>;
  readonly herTrophyCase: (userId: string) => Promise<TrophyCase>;
  readonly markHerRevealed: (userId: string, body: MarkRevealedBody) => Promise<TrophyCase>;
  readonly creatorTrophyCase: (readerId: string, creatorId: string) => Promise<TrophyCase>;
}

const CreatorParamsSchema = z.object({ creatorId: CreatorIdSchema });

function sessionUserOf(request: { readonly user: { readonly id: string } | null }): string {
  if (request.user === null) throw new Error('requireRole ran without a user');
  return request.user.id;
}

/**
 * The game's routes, none of which takes another account's id: the session's own case is the session's.
 * `GET /v1/rewards/my-trophy-case` and its reveals: the chatter's (ADR 0104 § 18: no comparison).
 * `GET /v1/creator-space/trophy-case` and its reveals: the creator's own (ADR 0107 § 10 and § 11).
 * `GET /v1/creators/:creatorId/trophy-case`: hers on her profile, for the owner and an active manager (§ 12).
 */
export function createRewardsRoutes(
  api: RewardsRoutesApi,
  options: RewardsRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/rewards/my-trophy-case',
      { preValidation: options.guard, schema: { response: { 200: TrophyCaseSchema } } },
      (request) => api.myTrophyCase(sessionUserOf(request)),
    );
    app.post(
      '/rewards/my-trophy-case/reveals',
      {
        preValidation: options.guard,
        schema: { body: MarkRevealedBodySchema, response: { 200: TrophyCaseSchema } },
      },
      (request) => api.markRevealed(sessionUserOf(request), request.body),
    );
    app.get(
      '/creator-space/trophy-case',
      { preValidation: options.creatorGuard, schema: { response: { 200: TrophyCaseSchema } } },
      (request) => api.herTrophyCase(sessionUserOf(request)),
    );
    app.post(
      '/creator-space/trophy-case/reveals',
      {
        preValidation: options.creatorGuard,
        schema: { body: MarkRevealedBodySchema, response: { 200: TrophyCaseSchema } },
      },
      (request) => api.markHerRevealed(sessionUserOf(request), request.body),
    );
    app.get(
      '/creators/:creatorId/trophy-case',
      {
        preValidation: options.agencyGuard,
        schema: { params: CreatorParamsSchema, response: { 200: TrophyCaseSchema } },
      },
      (request) => api.creatorTrophyCase(sessionUserOf(request), request.params.creatorId),
    );
    return Promise.resolve();
  };
}
