import {
  LevelSettingsSchema,
  LevelThresholdsSchema,
  MarkRevealedBodySchema,
  MyShiftChallengeSchema,
  TeamMemberIdSchema,
  TrophyCaseSchema,
  type LevelSettings,
  type LevelThresholds,
  type MarkRevealedBody,
  type MyShiftChallenge,
  type TeamMemberId,
  type TrophyCase,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { MemberNotFound } from '../domain/errors';

export interface RewardsRoutesOptions {
  /** `requireRole('operator')`: the game is the team's; the owner and a creator have no case here. */
  readonly guard: preValidationAsyncHookHandler;
  /** `requireRole('owner', 'operator')`: a member's file; the database decides who sees which member (§ 20). */
  readonly teamGuard: preValidationAsyncHookHandler;
  /** `requireRole('owner')`: the thresholds of the levels are the owner's setting (§ 16). */
  readonly ownerGuard: preValidationAsyncHookHandler;
}

export interface RewardsRoutesApi {
  readonly myTrophyCase: (userId: string) => Promise<TrophyCase>;
  readonly markRevealed: (userId: string, body: MarkRevealedBody) => Promise<TrophyCase>;
  readonly myShiftChallenge: (userId: string) => Promise<MyShiftChallenge>;
  readonly memberTrophyCase: (viewerId: string, memberId: TeamMemberId) => Promise<TrophyCase | null>;
  readonly levelSettings: (userId: string) => Promise<LevelSettings>;
  readonly saveLevelThresholds: (userId: string, body: LevelThresholds) => Promise<LevelSettings>;
}

const MemberParamsSchema = z.object({ memberId: TeamMemberIdSchema });

const userOf = (request: FastifyRequest): string => {
  if (request.user === null) throw new Error('requireRole ran without a user');
  return request.user.id;
};

/**
 * `GET /v1/rewards/my-trophy-case`: the session's own trophies, streak and tiers reached, nobody else's (ADR 0104
 * § 18: no comparison). `POST /v1/rewards/my-trophy-case/reveals`: the reveals the session has just seen. Neither
 * takes an id: the account is the session's. `GET /v1/rewards/my-shift-challenge`: the session's own challenge
 * (§ 14). `GET /v1/rewards/members/:memberId/trophy-case`: a member's trophies, streak and rank on their file, read
 * only (§ 20). `GET` and `PUT /v1/rewards/level-thresholds`: the owner's setting (§ 16).
 */
export function createRewardsRoutes(
  api: RewardsRoutesApi,
  options: RewardsRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    const { guard, teamGuard, ownerGuard } = options;
    app.get(
      '/rewards/my-trophy-case',
      { preValidation: guard, schema: { response: { 200: TrophyCaseSchema } } },
      (request) => api.myTrophyCase(userOf(request)),
    );
    app.post(
      '/rewards/my-trophy-case/reveals',
      { preValidation: guard, schema: { body: MarkRevealedBodySchema, response: { 200: TrophyCaseSchema } } },
      (request) => api.markRevealed(userOf(request), request.body),
    );
    app.get(
      '/rewards/my-shift-challenge',
      { preValidation: guard, schema: { response: { 200: MyShiftChallengeSchema } } },
      (request) => api.myShiftChallenge(userOf(request)),
    );
    app.get(
      '/rewards/members/:memberId/trophy-case',
      {
        preValidation: teamGuard,
        schema: { params: MemberParamsSchema, response: { 200: TrophyCaseSchema } },
      },
      async (request) => {
        const found = await api.memberTrophyCase(userOf(request), request.params.memberId);
        if (found === null) throw new MemberNotFound();
        return found;
      },
    );
    app.get(
      '/rewards/level-thresholds',
      { preValidation: ownerGuard, schema: { response: { 200: LevelSettingsSchema } } },
      (request) => api.levelSettings(userOf(request)),
    );
    app.put(
      '/rewards/level-thresholds',
      {
        preValidation: ownerGuard,
        schema: { body: LevelThresholdsSchema, response: { 200: LevelSettingsSchema } },
      },
      (request) => api.saveLevelThresholds(userOf(request), request.body),
    );
    return Promise.resolve();
  };
}
