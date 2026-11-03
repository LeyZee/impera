import {
  AcceptSuggestionBodySchema,
  AgencySuggestionListSchema,
  AgencySuggestionSchema,
  AgencySuggestionsQuerySchema,
  AvailabilityIdSchema,
  AvailabilitySchema,
  CreateAvailabilityBodySchema,
  CreateCreatorTaskBodySchema,
  CreateSuggestionBodySchema,
  CreatorAgendaQuerySchema,
  CreatorAgendaSchema,
  CreatorIdSchema,
  CreatorStreakResultSchema,
  CreatorTaskIdSchema,
  CreatorTaskSchema,
  CreatorTickParamsSchema,
  CreatorTicksBodySchema,
  CreatorTicksResultSchema,
  DeclineSuggestionBodySchema,
  DomainError,
  SuggestionIdSchema,
  UpdateCreatorTaskBodySchema,
  type UserRole,
} from '@impera/contracts';
import { NotACreatorAccount } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AgencySuggestionStore, CreatorAgendaStore } from '../../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

/** A `creator` session whose account is not linked to exactly one creator (the base forbids it): refused. */
class CreatorAccountForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Ce compte n’est lié à aucune créatrice');
  }
}

function signedIn(user: { readonly id: string } | null): string {
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return user.id;
}

async function asCreator<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NotACreatorAccount) throw new CreatorAccountForbidden();
    throw error;
  }
}

const TaskParamsSchema = z.object({ id: CreatorTaskIdSchema });
const AvailabilityParamsSchema = z.object({ id: AvailabilityIdSchema });
const SuggestionParamsSchema = z.object({ id: SuggestionIdSchema });
const CreatorParamsSchema = z.object({ creatorId: CreatorIdSchema });

/**
 * Her agenda under `/v1/creator-space` (creator, CR-05), and the agency's suggestions under
 * `/v1/creators/:creatorId/suggestions` (owner, operator: the store refuses a chatter). Her creator is read in her
 * account, never in the request. `now` is the server's clock.
 */
export function createCreatorTaskRoutes(
  agenda: CreatorAgendaStore,
  agency: AgencySuggestionStore,
  requireRole: RequireRole,
  clock: () => Date = () => new Date(),
): FastifyPluginAsyncZod {
  return (app) => {
    const creatorOnly = { preValidation: requireRole('creator') };

    app.get(
      '/creator-space/agenda',
      {
        ...creatorOnly,
        schema: { querystring: CreatorAgendaQuerySchema, response: { 200: CreatorAgendaSchema } },
      },
      (request) => asCreator(() => agenda.agenda(signedIn(request.user), request.query, clock())),
    );

    app.post(
      '/creator-space/tasks',
      { ...creatorOnly, schema: { body: CreateCreatorTaskBodySchema, response: { 200: CreatorTaskSchema } } },
      (request) => asCreator(() => agenda.createTask(signedIn(request.user), request.body)),
    );

    app.patch(
      '/creator-space/tasks/:id',
      {
        ...creatorOnly,
        schema: {
          params: TaskParamsSchema,
          body: UpdateCreatorTaskBodySchema,
          response: { 200: CreatorTaskSchema },
        },
      },
      (request) =>
        asCreator(() => agenda.updateTask(signedIn(request.user), request.params.id, request.body)),
    );

    app.delete(
      '/creator-space/tasks/:id',
      { ...creatorOnly, schema: { params: TaskParamsSchema } },
      async (request, reply) => {
        await asCreator(() => agenda.archiveTask(signedIn(request.user), request.params.id));
        return reply.code(204).send();
      },
    );

    app.post(
      '/creator-space/ticks',
      {
        ...creatorOnly,
        schema: { body: CreatorTicksBodySchema, response: { 200: CreatorTicksResultSchema } },
      },
      (request) => asCreator(() => agenda.tick(signedIn(request.user), request.body, clock())),
    );

    app.delete(
      '/creator-space/tasks/:id/ticks/:day',
      {
        ...creatorOnly,
        schema: { params: CreatorTickParamsSchema, response: { 200: CreatorStreakResultSchema } },
      },
      (request) =>
        asCreator(() =>
          agenda.untick(signedIn(request.user), request.params.id, request.params.day, clock()),
        ),
    );

    app.post(
      '/creator-space/availabilities',
      {
        ...creatorOnly,
        schema: { body: CreateAvailabilityBodySchema, response: { 200: AvailabilitySchema } },
      },
      (request) => asCreator(() => agenda.createAvailability(signedIn(request.user), request.body)),
    );

    app.delete(
      '/creator-space/availabilities/:id',
      { ...creatorOnly, schema: { params: AvailabilityParamsSchema } },
      async (request, reply) => {
        await asCreator(() => agenda.archiveAvailability(signedIn(request.user), request.params.id));
        return reply.code(204).send();
      },
    );

    app.post(
      '/creator-space/suggestions/:id/accept',
      {
        ...creatorOnly,
        schema: {
          params: SuggestionParamsSchema,
          body: AcceptSuggestionBodySchema,
          response: { 200: CreatorTaskSchema },
        },
      },
      (request) =>
        asCreator(() => agenda.accept(signedIn(request.user), request.params.id, request.body, clock())),
    );

    app.post(
      '/creator-space/suggestions/:id/decline',
      { ...creatorOnly, schema: { params: SuggestionParamsSchema, body: DeclineSuggestionBodySchema } },
      async (request, reply) => {
        await asCreator(() =>
          agenda.decline(signedIn(request.user), request.params.id, request.body, clock()),
        );
        return reply.code(204).send();
      },
    );

    app.post(
      '/creators/:creatorId/suggestions',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: CreatorParamsSchema,
          body: CreateSuggestionBodySchema,
          response: { 200: AgencySuggestionSchema },
        },
      },
      (request) => agency.create(request.params.creatorId, signedIn(request.user), request.body, clock()),
    );

    app.get(
      '/creators/:creatorId/suggestions',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: CreatorParamsSchema,
          querystring: AgencySuggestionsQuerySchema,
          response: { 200: AgencySuggestionListSchema },
        },
      },
      (request) => agency.list(request.params.creatorId, signedIn(request.user), request.query.week),
    );

    return Promise.resolve();
  };
}
