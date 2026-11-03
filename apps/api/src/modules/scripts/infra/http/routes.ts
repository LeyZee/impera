import {
  CreateScriptStructureBodySchema,
  CreatorIdSchema,
  DomainError,
  SaveScriptStructureBodySchema,
  ScriptQueueBodySchema,
  ScriptQueueSchema,
  ScriptStructureIdSchema,
  ScriptStructureListSchema,
  ScriptStructureSchema,
  type CreatorId,
  type PersonaLimits,
  type ScriptErrorCode,
  type UserRole,
} from '@nirvana/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { QueueRefusal, ScriptStructureStore } from '../../domain/ports';
import { queueRefusals, queueView } from '../../domain/queue';

const StructureParamsSchema = z.object({ structureId: ScriptStructureIdSchema });
const CreatorParamsSchema = z.object({ creatorId: CreatorIdSchema });

class ScriptStructureNotFound extends DomainError {
  constructor() {
    super('script_structure_not_found' satisfies ScriptErrorCode, 'Structure introuvable');
  }
}

class ScriptStructureConflict extends DomainError {
  constructor() {
    super(
      'script_structure_conflict' satisfies ScriptErrorCode,
      'Une autre structure porte déjà cet identifiant',
    );
  }
}

class ScriptStructureStale extends DomainError {
  constructor() {
    super(
      'script_structure_stale_conflict' satisfies ScriptErrorCode,
      'La structure a changé depuis ta lecture : recharge-la avant d’enregistrer',
    );
  }
}

class ScriptStructureCreatorInvalid extends DomainError {
  constructor() {
    super(
      'script_structure_creator_invalid' satisfies ScriptErrorCode,
      'La créatrice n’existe pas, ou la structure est dans la file d’une autre créatrice',
    );
  }
}

class ScriptQueueCreatorNotFound extends DomainError {
  constructor() {
    super('script_queue_creator_not_found' satisfies ScriptErrorCode, 'Créatrice introuvable');
  }
}

class ScriptQueueStructureUnprocessable extends DomainError {
  constructor(structureIds: readonly string[]) {
    super(
      'script_queue_structure_unprocessable' satisfies ScriptErrorCode,
      'Une structure est inconnue, archivée ou réservée à une autre créatrice',
      { details: { structureIds } },
    );
  }
}

/** A stage touches what she never does, never shows, or is disgusted by: the screen names it (ADR 0056 § 1). */
class ScriptQueueDisgustUnprocessable extends DomainError {
  constructor(refusals: readonly QueueRefusal[]) {
    super(
      'script_queue_disgust_unprocessable' satisfies ScriptErrorCode,
      'Une étape touche une limite de sa persona : la structure ne peut pas lui être demandée',
      { details: { refusals } },
    );
  }
}

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

/** Her persona's limits, from her active version; `null` without one. */
export type LimitsOf = (creatorId: CreatorId) => Promise<PersonaLimits | null>;

function signedIn(user: { readonly id: string } | null): string {
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return user.id;
}

/**
 * `/v1/script-structures` and `/v1/creators/:creatorId/script-queue` (SC-01, ADR 0056 § 1 and 2). The owner writes; the
 * owner and the active managers read (an operator who is not a manager reads nothing: the policies). A structure is
 * written under the client's id; a save names the version it was read from.
 */
export function createScriptRoutes(
  store: ScriptStructureStore,
  limitsOf: LimitsOf,
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/script-structures',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: { response: { 200: ScriptStructureListSchema } },
      },
      (request) => store.list(signedIn(request.user)),
    );

    app.get(
      '/script-structures/:structureId',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: { params: StructureParamsSchema, response: { 200: ScriptStructureSchema } },
      },
      async (request) => {
        const found = await store.get(request.params.structureId, signedIn(request.user));
        if (found === null) throw new ScriptStructureNotFound();
        return found;
      },
    );

    app.post(
      '/script-structures',
      {
        preValidation: requireRole('owner'),
        schema: {
          body: CreateScriptStructureBodySchema,
          response: { 200: ScriptStructureSchema, 201: ScriptStructureSchema },
        },
      },
      async (request, reply) => {
        const written = await store.create(request.body, signedIn(request.user));
        if (written.kind === 'conflict') throw new ScriptStructureConflict();
        if (written.kind === 'creator_invalid') throw new ScriptStructureCreatorInvalid();
        return reply.code(written.kind === 'created' ? 201 : 200).send(written.structure);
      },
    );

    app.put(
      '/script-structures/:structureId',
      {
        preValidation: requireRole('owner'),
        schema: {
          params: StructureParamsSchema,
          body: SaveScriptStructureBodySchema,
          response: { 200: ScriptStructureSchema },
        },
      },
      async (request) => {
        const saved = await store.save(request.params.structureId, request.body, signedIn(request.user));
        if (saved === 'not_found') throw new ScriptStructureNotFound();
        if (saved === 'stale') throw new ScriptStructureStale();
        if (saved === 'creator_invalid') throw new ScriptStructureCreatorInvalid();
        return saved;
      },
    );

    app.delete(
      '/script-structures/:structureId',
      { preValidation: requireRole('owner'), schema: { params: StructureParamsSchema } },
      async (request, reply) => {
        if (!(await store.archive(request.params.structureId, signedIn(request.user))))
          throw new ScriptStructureNotFound();
        return reply.code(204).send();
      },
    );

    app.get(
      '/creators/:creatorId/script-queue',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: { params: CreatorParamsSchema, response: { 200: ScriptQueueSchema } },
      },
      async (request) => {
        const { creatorId } = request.params;
        const entries = await store.queue(creatorId, signedIn(request.user));
        if (entries === null) throw new ScriptQueueCreatorNotFound();
        return queueView(creatorId, entries, await limitsOf(creatorId));
      },
    );

    app.put(
      '/creators/:creatorId/script-queue',
      {
        preValidation: requireRole('owner'),
        schema: {
          params: CreatorParamsSchema,
          body: ScriptQueueBodySchema,
          response: { 200: ScriptQueueSchema },
        },
      },
      async (request) => {
        const { creatorId } = request.params;
        const limits = await limitsOf(creatorId);
        const written = await store.setQueue(
          creatorId,
          request.body.structureIds,
          signedIn(request.user),
          (entries) => queueRefusals(entries, limits),
        );
        if (written.kind === 'creator_not_found') throw new ScriptQueueCreatorNotFound();
        if (written.kind === 'unprocessable')
          throw new ScriptQueueStructureUnprocessable(written.structureIds);
        if (written.kind === 'blocked') throw new ScriptQueueDisgustUnprocessable(written.refusals);
        return queueView(creatorId, written.entries, limits);
      },
    );
    return Promise.resolve();
  };
}
