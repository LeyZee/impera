import {
  AnnouncementIdSchema,
  AnnouncementListSchema,
  AnnouncementReaderListSchema,
  AnnouncementReadSchema,
  AnnouncementSchema,
  CreateAnnouncementBodySchema,
  DomainError,
  UserIdSchema,
  type UserId,
} from '@impera/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AnnouncementService } from '../../application/announcements';
import type { Actor } from '../../domain/ports';

import type { RequireRole } from './routes';

const AnnouncementParamsSchema = z.object({ announcementId: AnnouncementIdSchema });

function userOf(request: FastifyRequest): UserId {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return UserIdSchema.parse(request.user.id);
}

const actorOf = (request: FastifyRequest): Actor => ({ userId: userOf(request), ip: request.ip });

/**
 * `/v1/team/announcements` (EQ-12): the owner and the team's accounts, never a creator's. Who writes, who reads which
 * and who sees the reads is the database's call (`withMember`) and the store's: the owner and the active managers
 * write and see who read; each member reads those addressed to him and says « Lu ».
 */
export function createAnnouncementRoutes(
  announcements: AnnouncementService,
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  const ownerOrMember = requireRole('owner', 'operator');
  return (app) => {
    app.get(
      '/team/announcements',
      { preValidation: ownerOrMember, schema: { response: { 200: AnnouncementListSchema } } },
      async (request) => ({ announcements: await announcements.list(userOf(request)) }),
    );

    app.post(
      '/team/announcements',
      {
        preValidation: ownerOrMember,
        schema: { body: CreateAnnouncementBodySchema, response: { 201: AnnouncementSchema } },
      },
      async (request, reply) =>
        reply.code(201).send(await announcements.create(actorOf(request), request.body)),
    );

    app.post(
      '/team/announcements/:announcementId/read',
      {
        preValidation: ownerOrMember,
        schema: { params: AnnouncementParamsSchema, response: { 200: AnnouncementReadSchema } },
      },
      async (request) => announcements.read(actorOf(request), request.params.announcementId),
    );

    app.get(
      '/team/announcements/:announcementId/readers',
      {
        preValidation: ownerOrMember,
        schema: { params: AnnouncementParamsSchema, response: { 200: AnnouncementReaderListSchema } },
      },
      async (request) => ({
        readers: await announcements.readers(userOf(request), request.params.announcementId),
      }),
    );

    app.post(
      '/team/announcements/:announcementId/withdraw',
      { preValidation: ownerOrMember, schema: { params: AnnouncementParamsSchema } },
      async (request, reply) => {
        await announcements.withdraw(actorOf(request), request.params.announcementId);
        return reply.code(204).send();
      },
    );
    return Promise.resolve();
  };
}
