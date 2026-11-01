import {
  AddTeamMemberNoteBodySchema,
  ChangeTeamMemberStatusBodySchema,
  CommissionPresetListSchema,
  CommissionPresetSchema,
  CommissionRateHistorySchema,
  CommissionRateSchema,
  CreateCommissionPresetBodySchema,
  CreateTeamMemberBodySchema,
  DomainError,
  SetCommissionRateBodySchema,
  SetTeamRoleBodySchema,
  TeamMemberIdSchema,
  TeamMemberListSchema,
  TeamMemberNoteListSchema,
  TeamMemberNoteSchema,
  TeamMemberSchema,
  TeamRoleChangeSchema,
  TeamRoleHistorySchema,
  UpdateTeamMemberBodySchema,
  UserIdSchema,
  type UserId,
  type UserRole,
} from '@nirvana/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { TeamService } from '../../application/team';
import type { Actor } from '../../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

const MemberParamsSchema = z.object({ memberId: TeamMemberIdSchema });

function userOf(request: FastifyRequest): UserId {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return UserIdSchema.parse(request.user.id);
}

const actorOf = (request: FastifyRequest): Actor => ({ userId: userOf(request), ip: request.ip });

/**
 * `/v1/team` (EQ-01, ADR 0024): the owner and the chatters' accounts reach it, a creator never; what each one reads
 * is the database's call (`withMember`): everyone for the owner and an active manager, his own record otherwise.
 * Members, rates, roles and presets are written by the owner; the notes by the owner and the active managers.
 */
export function createTeamRoutes(team: TeamService, requireRole: RequireRole): FastifyPluginAsyncZod {
  const ownerOrMember = requireRole('owner', 'operator');
  const owner = requireRole('owner');
  return (app) => {
    app.get(
      '/team/members',
      { preValidation: ownerOrMember, schema: { response: { 200: TeamMemberListSchema } } },
      async (request) => ({ members: await team.members(userOf(request)) }),
    );

    app.post(
      '/team/members',
      {
        preValidation: owner,
        schema: { body: CreateTeamMemberBodySchema, response: { 201: TeamMemberSchema } },
      },
      async (request, reply) => reply.code(201).send(await team.addMember(actorOf(request), request.body)),
    );

    app.get(
      '/team/members/:memberId',
      {
        preValidation: ownerOrMember,
        schema: { params: MemberParamsSchema, response: { 200: TeamMemberSchema } },
      },
      (request) => team.member(userOf(request), request.params.memberId),
    );

    app.patch(
      '/team/members/:memberId',
      {
        preValidation: owner,
        schema: {
          params: MemberParamsSchema,
          body: UpdateTeamMemberBodySchema,
          response: { 200: TeamMemberSchema },
        },
      },
      (request) => team.updateMember(actorOf(request), request.params.memberId, request.body),
    );

    app.put(
      '/team/members/:memberId/status',
      {
        preValidation: owner,
        schema: {
          params: MemberParamsSchema,
          body: ChangeTeamMemberStatusBodySchema,
          response: { 200: TeamMemberSchema },
        },
      },
      (request) => team.changeStatus(actorOf(request), request.params.memberId, request.body.status),
    );

    app.get(
      '/team/members/:memberId/commission',
      {
        preValidation: ownerOrMember,
        schema: { params: MemberParamsSchema, response: { 200: CommissionRateHistorySchema } },
      },
      async (request) => ({ rates: await team.commissionHistory(userOf(request), request.params.memberId) }),
    );

    app.post(
      '/team/members/:memberId/commission',
      {
        preValidation: owner,
        schema: {
          params: MemberParamsSchema,
          body: SetCommissionRateBodySchema,
          response: { 201: CommissionRateSchema },
        },
      },
      async (request, reply) =>
        reply
          .code(201)
          .send(await team.setCommission(actorOf(request), request.params.memberId, request.body)),
    );

    app.get(
      '/team/members/:memberId/role',
      {
        preValidation: ownerOrMember,
        schema: { params: MemberParamsSchema, response: { 200: TeamRoleHistorySchema } },
      },
      async (request) => ({ roles: await team.roleHistory(userOf(request), request.params.memberId) }),
    );

    app.post(
      '/team/members/:memberId/role',
      {
        preValidation: owner,
        schema: {
          params: MemberParamsSchema,
          body: SetTeamRoleBodySchema,
          response: { 201: TeamRoleChangeSchema },
        },
      },
      async (request, reply) =>
        reply.code(201).send(await team.setRole(actorOf(request), request.params.memberId, request.body)),
    );

    app.get(
      '/team/members/:memberId/notes',
      {
        preValidation: ownerOrMember,
        schema: { params: MemberParamsSchema, response: { 200: TeamMemberNoteListSchema } },
      },
      async (request) => ({ notes: await team.notes(userOf(request), request.params.memberId) }),
    );

    app.post(
      '/team/members/:memberId/notes',
      {
        preValidation: ownerOrMember,
        schema: {
          params: MemberParamsSchema,
          body: AddTeamMemberNoteBodySchema,
          response: { 201: TeamMemberNoteSchema },
        },
      },
      async (request, reply) =>
        reply
          .code(201)
          .send(await team.addNote(actorOf(request), request.params.memberId, request.body.body)),
    );

    app.get(
      '/team/commission-presets',
      { preValidation: ownerOrMember, schema: { response: { 200: CommissionPresetListSchema } } },
      async (request) => ({ presets: await team.presets(userOf(request)) }),
    );

    app.post(
      '/team/commission-presets',
      {
        preValidation: owner,
        schema: { body: CreateCommissionPresetBodySchema, response: { 201: CommissionPresetSchema } },
      },
      async (request, reply) => reply.code(201).send(await team.addPreset(actorOf(request), request.body)),
    );
    return Promise.resolve();
  };
}
