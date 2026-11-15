import {
  CreatorIdSchema,
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
  /** `requireRole('operator')`: the chatter's game is the team's; the owner has no case here. */
  readonly guard: preValidationAsyncHookHandler;
  /** `requireRole('owner', 'operator')`: a member's file; the database decides who sees which member (§ 20). */
  readonly teamGuard: preValidationAsyncHookHandler;
  /** `requireRole('owner')`: the thresholds of the levels are the owner's setting (§ 16). */
  readonly ownerGuard: preValidationAsyncHookHandler;
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
  readonly myShiftChallenge: (userId: string) => Promise<MyShiftChallenge>;
  readonly memberTrophyCase: (viewerId: string, memberId: TeamMemberId) => Promise<TrophyCase | null>;
  readonly levelSettings: (userId: string) => Promise<LevelSettings>;
  readonly saveLevelThresholds: (userId: string, body: LevelThresholds) => Promise<LevelSettings>;
  readonly herTrophyCase: (userId: string) => Promise<TrophyCase>;
  readonly markHerRevealed: (userId: string, body: MarkRevealedBody) => Promise<TrophyCase>;
  readonly creatorTrophyCase: (readerId: string, creatorId: string) => Promise<TrophyCase>;
}

const MemberParamsSchema = z.object({ memberId: TeamMemberIdSchema });
const CreatorParamsSchema = z.object({ creatorId: CreatorIdSchema });

const userOf = (request: FastifyRequest): string => {
  if (request.user === null) throw new Error('requireRole ran without a user');
  return request.user.id;
};

/**
 * The game's routes. None takes the session's own id: the account is the session's.
 * `GET /v1/rewards/my-trophy-case` and its reveals: the chatter's own trophies, streak and tiers, nobody else's
 * (ADR 0104 § 18: no comparison). `GET /v1/rewards/my-shift-challenge`: the session's own challenge (§ 14).
 * `GET /v1/rewards/members/:memberId/trophy-case`: a member's trophies, streak and rank on their file, read only
 * (§ 20). `GET` and `PUT /v1/rewards/level-thresholds`: the owner's setting (§ 16).
 * `GET /v1/creator-space/trophy-case` and its reveals: the creator's own (ADR 0107 § 10 and § 11).
 * `GET /v1/creators/:creatorId/trophy-case`: hers on her profile, for the owner and an active manager (§ 12).
 */
export function createRewardsRoutes(
  api: RewardsRoutesApi,
  options: RewardsRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    const { guard, teamGuard, ownerGuard, creatorGuard, agencyGuard } = options;
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
    app.get(
      '/creator-space/trophy-case',
      { preValidation: creatorGuard, schema: { response: { 200: TrophyCaseSchema } } },
      (request) => api.herTrophyCase(userOf(request)),
    );
    app.post(
      '/creator-space/trophy-case/reveals',
      {
        preValidation: creatorGuard,
        schema: { body: MarkRevealedBodySchema, response: { 200: TrophyCaseSchema } },
      },
      (request) => api.markHerRevealed(userOf(request), request.body),
    );
    app.get(
      '/creators/:creatorId/trophy-case',
      {
        preValidation: agencyGuard,
        schema: { params: CreatorParamsSchema, response: { 200: TrophyCaseSchema } },
      },
      (request) => api.creatorTrophyCase(userOf(request), request.params.creatorId),
    );
    return Promise.resolve();
  };
}
