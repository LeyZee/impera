import {
  CreatorIdSchema,
  DRAFT_CORRECTIONS_DAYS,
  DraftCorrectionsViewSchema,
  type CreatorId,
} from '@impera/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { draftCorrectionsView, type DraftCorrectionRow } from '../../domain/draft-corrections';
import type { Clock } from '../../domain/ports';

import { actorFor, type RequireRole } from './routes';

const DAY_MS = 86_400_000;

/**
 * `GET /v1/creators/:creatorId/draft-corrections` (trou béant 12): Entraîner › Corrections, the drafts a human refused
 * or retouched in her real conversations. The owner's alone, as the playground's corrections are (ADR 0092 § 8): a
 * manager, a chatter and the creator are refused. Read only.
 */
export function createDraftCorrectionsRoutes(
  read: (creatorId: CreatorId, since: Date) => Promise<DraftCorrectionRow[]>,
  requireRole: RequireRole,
  clock: Clock,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/creators/:creatorId/draft-corrections',
      {
        preValidation: requireRole('owner'),
        schema: {
          params: z.object({ creatorId: CreatorIdSchema }),
          response: { 200: DraftCorrectionsViewSchema },
        },
      },
      async (request) => {
        const { creatorId } = request.params;
        actorFor(request, creatorId);
        const since = new Date(clock.now().getTime() - DRAFT_CORRECTIONS_DAYS * DAY_MS);
        return draftCorrectionsView(creatorId, since, await read(creatorId, since));
      },
    );
    return Promise.resolve();
  };
}
