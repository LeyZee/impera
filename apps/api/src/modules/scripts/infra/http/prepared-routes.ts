import {
  CreatePreparedScriptBodySchema,
  CreatorIdSchema,
  DomainError,
  PreparedScriptIdSchema,
  PreparedScriptListSchema,
  PreparedScriptStateBodySchema,
  PreparedScriptViewSchema,
  SavePreparedScriptBodySchema,
  type CreatorId,
  type PreparedScriptErrorCode,
  type PreparedScriptId,
  type PreparedScriptView as PreparedScriptDto,
} from '@impera/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  changePreparedState,
  createPreparedScript,
  listPreparedScripts,
  preparedScript,
  savePreparedScript,
  type ChangePreparedOutcome,
  type PreparedScriptView,
} from '../../application/prepared-scripts';
import type { LimitsOf, PreparedScriptStore } from '../../domain/ports';

import type { RequireRole } from './routes';

const CreatorParamsSchema = z.object({ creatorId: CreatorIdSchema });
const ScriptParamsSchema = z.object({ creatorId: CreatorIdSchema, scriptId: PreparedScriptIdSchema });

/** A refusal of these routes, its code one of `PREPARED_SCRIPT_ERROR_CODES`. */
const refusal = (code: PreparedScriptErrorCode, message: string) => new DomainError(code, message);

const notFound = () => refusal('prepared_script_not_found', 'Script introuvable');

function refusalOf(outcome: Exclude<ChangePreparedOutcome, 'updated'>): DomainError {
  switch (outcome) {
    case 'not_found':
      return notFound();
    case 'stale':
      return refusal(
        'prepared_script_stale_conflict',
        'Ce script a été enregistré par quelqu’un d’autre depuis ta lecture : recharge-le',
      );
    case 'closed':
      return refusal(
        'prepared_script_closed_conflict',
        'Ce script a été reconnu dans Reveal : il se modifie maintenant depuis le script importé',
      );
    case 'gaps':
      return refusal(
        'prepared_script_gaps_unprocessable',
        'Il manque encore quelque chose : le bandeau dit quoi et où',
      );
  }
}

function userIdOf(user: { readonly id: string } | null): string {
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return user.id;
}

/** A script in preparation as the wire carries it: dates in ISO. */
function dtoOf(view: PreparedScriptView): PreparedScriptDto {
  return {
    id: view.id,
    creatorId: view.creatorId,
    platformAccountId: view.platformAccountId,
    state: view.state,
    revision: view.revision,
    content: view.content,
    gaps: [...view.gaps],
    warnings: [...view.warnings],
    matchedPlatformScriptId: view.matchedPlatformScriptId,
    copyDifferences: view.copyDifferences === null ? null : [...view.copyDifferences],
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

/**
 * `/v1/creators/:creatorId/prepared-scripts` (ADR 0112 §§ 20-22): her scripts in preparation, read and written by the
 * owner and the active managers of her list. Anyone else gets the same 404 for a creator or a script that exists and
 * one that does not. Impera writes nothing at Reveal from here.
 */
export function createPreparedScriptRoutes(
  store: PreparedScriptStore,
  limitsOf: LimitsOf,
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  const deps = { store, limitsOf };
  const one = async (userId: string, creatorId: CreatorId, id: PreparedScriptId) => {
    const view = await preparedScript(deps, userId, creatorId, id);
    if (view === null) throw notFound();
    return dtoOf(view);
  };

  return (app) => {
    app.get(
      '/creators/:creatorId/prepared-scripts',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: { params: CreatorParamsSchema, response: { 200: PreparedScriptListSchema } },
      },
      async (request) => {
        const views = await listPreparedScripts(deps, userIdOf(request.user), request.params.creatorId);
        if (views === null) throw notFound();
        return views.map(dtoOf);
      },
    );

    app.get(
      '/creators/:creatorId/prepared-scripts/:scriptId',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: { params: ScriptParamsSchema, response: { 200: PreparedScriptViewSchema } },
      },
      (request) => one(userIdOf(request.user), request.params.creatorId, request.params.scriptId),
    );

    // Under the client's id: the same send replays (200), a new one is created (201).
    app.post(
      '/creators/:creatorId/prepared-scripts',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: CreatorParamsSchema,
          body: CreatePreparedScriptBodySchema,
          response: { 200: PreparedScriptViewSchema, 201: PreparedScriptViewSchema },
        },
      },
      async (request, reply) => {
        const userId = userIdOf(request.user);
        const { creatorId } = request.params;
        const outcome = await createPreparedScript({ store }, userId, creatorId, request.body);
        if (outcome === 'not_found') throw notFound();
        if (outcome === 'conflict')
          throw refusal('prepared_script_conflict', 'Cet identifiant est déjà pris par un autre script');
        if (outcome === 'account_invalid')
          throw refusal('prepared_script_account_invalid', 'Ce compte n’est pas un des siens');
        const view = await one(userId, creatorId, request.body.id);
        return reply.code(outcome === 'created' ? 201 : 200).send(view);
      },
    );

    app.put(
      '/creators/:creatorId/prepared-scripts/:scriptId',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: ScriptParamsSchema,
          body: SavePreparedScriptBodySchema,
          response: { 200: PreparedScriptViewSchema },
        },
      },
      async (request) => {
        const userId = userIdOf(request.user);
        const { creatorId, scriptId } = request.params;
        const outcome = await savePreparedScript(
          deps,
          userId,
          creatorId,
          scriptId,
          request.body.basedOnRevision,
          request.body.content,
        );
        if (outcome !== 'updated') throw refusalOf(outcome);
        return one(userId, creatorId, scriptId);
      },
    );

    for (const [path, to] of [
      ['ready', 'ready'],
      ['editing', 'editing'],
    ] as const)
      app.post(
        `/creators/:creatorId/prepared-scripts/:scriptId/${path}`,
        {
          preValidation: requireRole('owner', 'operator'),
          schema: {
            params: ScriptParamsSchema,
            body: PreparedScriptStateBodySchema,
            response: { 200: PreparedScriptViewSchema },
          },
        },
        async (request) => {
          const userId = userIdOf(request.user);
          const { creatorId, scriptId } = request.params;
          const outcome = await changePreparedState(
            deps,
            userId,
            creatorId,
            scriptId,
            request.body.basedOnRevision,
            to,
          );
          if (outcome !== 'updated') throw refusalOf(outcome);
          return one(userId, creatorId, scriptId);
        },
      );
    return Promise.resolve();
  };
}
