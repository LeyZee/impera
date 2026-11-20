import {
  CorrectPlatformScriptDescriptionBodySchema,
  CreatorIdSchema,
  DomainError,
  MediaDescriptionIdSchema,
  PlatformScriptIdSchema,
  PlatformScriptListSchema,
  PlatformScriptViewSchema,
  SetScriptBranchesBodySchema,
  ValidatePlatformScriptDescriptionsBodySchema,
  type CreatorId,
  type PlatformScriptViewDto,
  type ScriptErrorCode,
  type UserRole,
} from '@impera/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  creatorPlatformScripts,
  reviewScriptDescriptions,
  setScriptBranches,
  type PlatformScriptsReader,
  type PlatformScriptView,
} from '../../application/platform-script-reads';
import type {
  DescriptionReview,
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

class ScriptDescriptionStale extends DomainError {
  constructor() {
    super(
      'platform_script_description_stale_conflict' satisfies ScriptErrorCode,
      'Une description a changé depuis ta lecture : recharge le script avant de la valider',
    );
  }
}

class ScriptDescriptionAlone extends DomainError {
  constructor() {
    super(
      'platform_script_description_alone_conflict' satisfies ScriptErrorCode,
      'Une description à vérifier se valide seule, après l’avoir relue',
    );
  }
}

function readerOf(user: { readonly id: string; readonly role: UserRole } | null): PlatformScriptsReader {
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return { userId: user.id, role: user.role };
}

type MediaView = PlatformScriptView['steps'][number]['media'][number];

/** A media of a step as the wire carries it, with the description the agency reviews. */
function mediaDtoOf(media: MediaView): PlatformScriptViewDto['steps'][number]['media'][number] {
  return {
    ...media,
    description:
      media.description === null
        ? null
        : {
            id: MediaDescriptionIdSchema.parse(media.description.id),
            detailed: media.description.detailed,
            reviewReasons: [...media.description.reviewReasons],
            validated: media.description.validated,
          },
  };
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
      media: step.media.map(mediaDtoOf),
      previewMedia: step.previewMedia.map(mediaDtoOf),
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
 * descriptions of their media validated, or rewritten by hand, by the same. An operator who is not one of
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
  const described = async (
    creatorId: CreatorId,
    scriptId: string,
    reader: PlatformScriptsReader,
    review: DescriptionReview,
    correlationId: string,
  ): Promise<PlatformScriptViewDto> => {
    const outcome = await reviewScriptDescriptions(
      { store: reviews },
      reader,
      creatorId,
      scriptId,
      review,
      correlationId,
    );
    if (outcome === 'not_found') throw new PlatformScriptNotFound();
    if (outcome === 'stale') throw new ScriptDescriptionStale();
    if (outcome === 'alone') throw new ScriptDescriptionAlone();
    return one(creatorId, scriptId, reader);
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

    // The descriptions of its media as shown, validated as they are (ADR 0099 § 4): idempotent; each write asks the
    // script's identity again, which is told only from validated descriptions.
    app.post(
      '/creators/:creatorId/platform-scripts/:scriptId/descriptions/validate',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: ScriptParamsSchema,
          body: ValidatePlatformScriptDescriptionsBodySchema,
          response: { 200: PlatformScriptViewSchema },
        },
      },
      (request) =>
        described(
          request.params.creatorId,
          request.params.scriptId,
          readerOf(request.user),
          { kind: 'validate', descriptionIds: request.body.descriptionIds },
          request.id,
        ),
    );

    // A description rewritten by hand from the one shown, validated by whoever writes it.
    app.post(
      '/creators/:creatorId/platform-scripts/:scriptId/descriptions/correct',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: ScriptParamsSchema,
          body: CorrectPlatformScriptDescriptionBodySchema,
          response: { 200: PlatformScriptViewSchema },
        },
      },
      (request) =>
        described(
          request.params.creatorId,
          request.params.scriptId,
          readerOf(request.user),
          { kind: 'correct', descriptionId: request.body.descriptionId, detailed: request.body.detailed },
          request.id,
        ),
    );

    return Promise.resolve();
  };
}
