import {
  AcceptCreatorWeekBodySchema,
  AgencyCreatorWeekSchema,
  CreatorDayQuerySchema,
  CreatorProgressParamsSchema,
  CreatorProgressSchema,
  CreatorWeekParamsSchema,
  CreatorWeekQuerySchema,
  CreatorWeekSchema,
  DayItemDoneBodySchema,
  DayItemParamsSchema,
  DomainError,
  HerDaySchema,
  ShootItemDoneBodySchema,
  ShootItemParamsSchema,
  ValidateCreatorWeekBodySchema,
  type UserRole,
} from '@impera/contracts';
import { NotACreatorAccount } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { WeekAgendaStore } from '../../../creator-tasks';
import { herDay } from '../../application/her-day';
import { acceptWeek, creatorProgress, herWeek } from '../../application/her-week';
import { validateWeek } from '../../application/validate';
import { mondayOf } from '../../domain/plan';
import type { AcceptSuggestion, DayTickStore, WeekDraftStore, WeekFactsReader } from '../../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

export interface WeekRoutesDeps {
  readonly drafts: WeekDraftStore;
  readonly days: DayTickStore;
  readonly agenda: WeekAgendaStore;
  readonly accept: AcceptSuggestion;
  readonly facts: Pick<WeekFactsReader, 'arrivals' | 'teamArrivals'>;
  readonly requireRole: RequireRole;
  readonly clock?: () => Date;
}

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

/** Her week, or `{ week: null }` while it is not computed yet. */
const AgencyCreatorWeekReadSchema = z.union([AgencyCreatorWeekSchema, z.strictObject({ week: z.null() })]);

const AcceptedSchema = z.strictObject({ accepted: z.number().int().min(0) });

/**
 * Her week (ADR 0140): the owner's reading and validation under `/v1/creators/:creatorId/weeks/:week` (an active
 * manager reads), hers under `/v1/creator-space/week` and `/v1/creator-space/shoot-items/:id`; her day under
 * `/v1/creator-space/day`. A week is named by her
 * Monday: any day of it reads the same week. `now` is the server's clock.
 */
export function createWeekRoutes(deps: WeekRoutesDeps): FastifyPluginAsyncZod {
  const clock = deps.clock ?? (() => new Date());
  return (app) => {
    const creatorOnly = { preValidation: deps.requireRole('creator') };

    app.get(
      '/creators/:creatorId/weeks/:week',
      {
        preValidation: deps.requireRole('owner', 'operator'),
        schema: { params: CreatorWeekParamsSchema, response: { 200: AgencyCreatorWeekReadSchema } },
      },
      async (request) => {
        const week = await deps.drafts.read(
          request.params.creatorId,
          signedIn(request.user),
          mondayOf(request.params.week),
        );
        // A week not computed yet is a normal case, never a 404 the browser logs as an error (MAN-08, DS-14).
        return week ?? { week: null };
      },
    );

    // « Où elle en est » (trous béants n° 11): her seven days and her validated week, as she reads them.
    app.get(
      '/creators/:creatorId/progress',
      {
        preValidation: deps.requireRole('owner', 'operator'),
        schema: {
          params: CreatorProgressParamsSchema,
          querystring: CreatorWeekQuerySchema,
          response: { 200: CreatorProgressSchema },
        },
      },
      (request) =>
        creatorProgress(
          { agenda: deps.agenda, facts: deps.facts, days: deps.days },
          request.params.creatorId,
          signedIn(request.user),
          mondayOf(request.query.week),
          clock(),
        ),
    );

    app.post(
      '/creators/:creatorId/weeks/:week/validate',
      {
        preValidation: deps.requireRole('owner'),
        schema: {
          params: CreatorWeekParamsSchema,
          body: ValidateCreatorWeekBodySchema,
          response: { 200: AgencyCreatorWeekSchema },
        },
      },
      (request) =>
        validateWeek(
          { drafts: deps.drafts, agenda: deps.agenda },
          request.params.creatorId,
          signedIn(request.user),
          mondayOf(request.params.week),
          request.body.plan,
          clock(),
        ),
    );

    app.get(
      '/creator-space/week',
      {
        ...creatorOnly,
        schema: { querystring: CreatorWeekQuerySchema, response: { 200: CreatorWeekSchema } },
      },
      (request) =>
        asCreator(() =>
          herWeek(
            { agenda: deps.agenda, facts: deps.facts },
            signedIn(request.user),
            mondayOf(request.query.week),
            clock(),
          ),
        ),
    );

    app.post(
      '/creator-space/week/accept',
      { ...creatorOnly, schema: { body: AcceptCreatorWeekBodySchema, response: { 200: AcceptedSchema } } },
      async (request) => ({
        accepted: await asCreator(() =>
          acceptWeek(
            { agenda: deps.agenda, accept: deps.accept },
            signedIn(request.user),
            mondayOf(request.body.week),
            clock(),
          ),
        ),
      }),
    );

    app.put(
      '/creator-space/shoot-items/:id',
      { ...creatorOnly, schema: { params: ShootItemParamsSchema, body: ShootItemDoneBodySchema } },
      async (request, reply) => {
        await asCreator(() =>
          deps.agenda.tickLine(signedIn(request.user), request.params.id, request.body.done, clock()),
        );
        return reply.code(204).send();
      },
    );

    app.get(
      '/creator-space/day',
      { ...creatorOnly, schema: { querystring: CreatorDayQuerySchema, response: { 200: HerDaySchema } } },
      (request) =>
        asCreator(() => herDay(deps.days, signedIn(request.user), request.query.day ?? null, clock())),
    );

    app.put(
      '/creator-space/day/:day/items/:item',
      { ...creatorOnly, schema: { params: DayItemParamsSchema, body: DayItemDoneBodySchema } },
      async (request, reply) => {
        await asCreator(() =>
          deps.days.write(
            signedIn(request.user),
            request.params.day,
            request.params.item,
            request.body.done,
            clock(),
          ),
        );
        return reply.code(204).send();
      },
    );

    return Promise.resolve();
  };
}
