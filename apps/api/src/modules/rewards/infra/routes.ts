import {
  MarkRevealedBodySchema,
  TrophyCaseSchema,
  type MarkRevealedBody,
  type TrophyCase,
} from '@impera/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export interface RewardsRoutesOptions {
  /** `requireRole('operator')`: the game is the team's; the owner and a creator have no case here. */
  readonly guard: preValidationAsyncHookHandler;
}

export interface RewardsRoutesApi {
  readonly myTrophyCase: (userId: string) => Promise<TrophyCase>;
  readonly markRevealed: (userId: string, body: MarkRevealedBody) => Promise<TrophyCase>;
}

/**
 * `GET /v1/rewards/my-trophy-case`: the session's own trophies, streak and tiers reached, nobody else's (ADR 0104
 * § 18: no comparison). `POST /v1/rewards/my-trophy-case/reveals`: the reveals the session has just seen. Neither
 * takes an id: the account is the session's.
 */
export function createRewardsRoutes(
  api: RewardsRoutesApi,
  options: RewardsRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', options.guard);
    app.get('/rewards/my-trophy-case', { schema: { response: { 200: TrophyCaseSchema } } }, (request) => {
      if (request.user === null) throw new Error('requireRole ran without a user');
      return api.myTrophyCase(request.user.id);
    });
    app.post(
      '/rewards/my-trophy-case/reveals',
      { schema: { body: MarkRevealedBodySchema, response: { 200: TrophyCaseSchema } } },
      (request) => {
        if (request.user === null) throw new Error('requireRole ran without a user');
        return api.markRevealed(request.user.id, request.body);
      },
    );
    return Promise.resolve();
  };
}
