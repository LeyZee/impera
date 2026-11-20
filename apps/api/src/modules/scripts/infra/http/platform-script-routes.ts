import {
  CorrectScriptIdentityBodySchema,
  CreatorIdSchema,
  DomainError,
  PlatformScriptIdSchema,
  PlatformScriptListSchema,
  PlatformScriptViewSchema,
  SetScriptBranchesBodySchema,
  ValidateScriptIdentityBodySchema,
  type CreatorId,
  type PlatformScriptViewDto,
  type ScriptErrorCode,
  type UserRole,
} from '@impera/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  creatorPlatformScripts,
  reviewScriptIdentity,
  setScriptBranches,
  type PlatformScriptsReader,
  type PlatformScriptView,
} from '../../application/platform-script-reads';
import type {
  IdentityReview,
  PlatformScriptReadStore,
  ScriptBranchStore,
  ScriptIdentityReviewStore,
} from '../../domain/ports';

import type { RequireRole } from './routes';

const CreatorParamsSchema = z.object({ creatorId: CreatorIdSchema });
const ScriptParamsSchema = z.object({ creatorId: CreatorIdSchema, scriptId: PlatformScriptIdSchema });
const StepParamsSchema = ScriptParamsSchema.extend({
  platformIndex: z.coerce.number().int().min(0).max(10_000),
});

class PlatformScriptNotFound extends DomainError {
  constructor() {
    super('platform_script_not_found' satisfies ScriptErrorCode, 'Script introuvable');
  }
}

class ScriptBranchesStale extends DomainError {
  constructor() {
    super(
      'platform_script_branches_stale_conflict' satisfies ScriptErrorCode,
      'Les branches de cette étape ont changé dans Reveal depuis ta lecture : recharge le script',
    );
  }
}

class ScriptIdentityStale extends DomainError {
  constructor() {
    super(
      'script_identity_stale_conflict' satisfies ScriptErrorCode,
      'Le script a changé depuis ta lecture : recharge-le avant de valider son identité',
    );
  }
}

function readerOf(user: { readonly id: string; readonly role: UserRole } | null): PlatformScriptsReader {
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return { userId: user.id, role: user.role };
}

/** A native script as the wire carries it: dates in ISO, its identity with the script's moment (ADR 0098 § 6). */
function dtoOf(view: PlatformScriptView): PlatformScriptViewDto {
  return {
    id: view.id,
    platformAccountId: view.platformAccountId,
    ref: view.ref,
    name: view.name,
    moment: view.moment,
    active: view.active,
    deactivatedAt: view.deactivatedAt?.toISOString() ?? null,
    syncedAt: view.syncedAt.toISOString(),
    steps: view.steps.map((step) => ({
      position: step.position,
      platformIndex: step.platformIndex,
      ref: step.ref,
      name: step.name,
      text: step.text,
      priceMinor: step.priceMinor,
      currency: step.currency,
      discount: step.discount,
      media: [...step.media],
      previewMedia: [...step.previewMedia],
      complete: step.complete,
      condition: step.condition,
      branches: step.branches,
    })),
    warnings: [...view.warnings],
    gaps: [...view.gaps],
    proposable: view.proposable,
    identity:
      view.identity === null
        ? null
        : {
            id: view.identity.id,
            moment: view.moment,
            content: view.identity.content,
            author: view.identity.author,
            validatedAt: view.identity.validatedAt?.toISOString() ?? null,
          },
  };
}

/**
 * `/v1/creators/:creatorId/platform-scripts` (ADR 0099 § 1 time 2, SC-04 lot c8): her native scripts imported from
 * the platform, read by the owner and the active managers of her list, with what keeps each from being offered; the
 * identity of a script's current version validated, or written by hand, by the same. An operator who is not one of
 * them reads nothing: the same 404 for a creator or a script that exists and one that does not.
 */
export function createPlatformScriptRoutes(
  reads: PlatformScriptReadStore,
  reviews: ScriptIdentityReviewStore,
  branches: ScriptBranchStore,
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  const listed = async (creatorId: CreatorId, reader: PlatformScriptsReader) => {
    const scripts = await creatorPlatformScripts({ store: reads }, reader, creatorId);
    if (scripts === null) throw new PlatformScriptNotFound();
    return scripts;
  };
  const reviewed = async (
    creatorId: CreatorId,
    scriptId: string,
    reader: PlatformScriptsReader,
    review: IdentityReview,
  ): Promise<PlatformScriptViewDto> => {
    const outcome = await reviewScriptIdentity({ store: reviews }, reader, creatorId, scriptId, review);
    if (outcome === 'not_found') throw new PlatformScriptNotFound();
    if (outcome === 'stale') throw new ScriptIdentityStale();
    const script = (await listed(creatorId, reader)).find((each) => each.id === scriptId);
    if (script === undefined) throw new PlatformScriptNotFound();
    return dtoOf(script);
  };

  const one = async (creatorId: CreatorId, scriptId: string, reader: PlatformScriptsReader) => {
    const script = (await listed(creatorId, reader)).find((each) => each.id === scriptId);
    if (script === undefined) throw new PlatformScriptNotFound();
    return dtoOf(script);
  };

  return (app) => {
    // Every branch of one step, in the agency's order, each with its condition (ADR 0112 §§ 5-6): the script as it
    // reads now in return, its gaps counted again.
    app.put(
      '/creators/:creatorId/platform-scripts/:scriptId/steps/:platformIndex/branches',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: StepParamsSchema,
          body: SetScriptBranchesBodySchema,
          response: { 200: PlatformScriptViewSchema },
        },
      },
      async (request) => {
        const { creatorId, scriptId, platformIndex } = request.params;
        const reader = readerOf(request.user);
        const outcome = await setScriptBranches(
          { store: branches },
          reader,
          creatorId,
          scriptId,
          platformIndex,
          request.body.branches,
        );
        if (outcome === 'not_found') throw new PlatformScriptNotFound();
        if (outcome === 'stale') throw new ScriptBranchesStale();
        return one(creatorId, scriptId, reader);
      },
    );

    app.get(
      '/creators/:creatorId/platform-scripts',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: { params: CreatorParamsSchema, response: { 200: PlatformScriptListSchema } },
      },
      async (request) => (await listed(request.params.creatorId, readerOf(request.user))).map(dtoOf),
    );

    // The identity shown, validated as it is: idempotent, a second validation changes nothing.
    app.post(
      '/creators/:creatorId/platform-scripts/:scriptId/identity/validate',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: ScriptParamsSchema,
          body: ValidateScriptIdentityBodySchema,
          response: { 200: PlatformScriptViewSchema },
        },
      },
      (request) =>
        reviewed(request.params.creatorId, request.params.scriptId, readerOf(request.user), {
          kind: 'validate',
          identityId: request.body.identityId,
        }),
    );

    // An identity written by hand for the script's current version, validated by whoever writes it.
    app.post(
      '/creators/:creatorId/platform-scripts/:scriptId/identity/correct',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: ScriptParamsSchema,
          body: CorrectScriptIdentityBodySchema,
          response: { 200: PlatformScriptViewSchema },
        },
      },
      (request) =>
        reviewed(request.params.creatorId, request.params.scriptId, readerOf(request.user), {
          kind: 'correct',
          content: request.body.content,
        }),
    );
    return Promise.resolve();
  };
}
