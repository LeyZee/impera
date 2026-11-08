/** Public entry point of the `trends` module (VEI-01, ADR 0060). Other modules import this file only. */
import type { CreatorId, JobPayload, PersonaLimits } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { LlmGateway } from '@impera/llm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { ContentDropsModule, IdeaContentRequest } from '../content-drops';
import type { CreatorTasksModule } from '../creator-tasks';

export { shootGuardFault } from './application/decide';
import { followDecision, followDeposit } from './application/follow';
import { createDrizzleIdeaFollowStore, createDrizzleIdeaStore } from './infra/db/idea-store';
import { createDrizzleExtensionLinkStore } from './infra/db/link-store';
import { createDrizzleReadingStore } from './infra/db/reading-store';
import { createDrizzleSignalStore } from './infra/db/signal-store';
import { createTrendRoutes, type RequireRole } from './infra/http/routes';
import { createGatewayCaptureVision } from './infra/vision';
export interface TrendsModule {
  readonly name: 'trends';
  /**
   * Mounted under `/v1` by the server: `/trends/links`, `/trends/extension-links`, `/trends/readings` and its captures,
   * and « Idées du jour » under `/creators/:creatorId/ideas`.
   */
  readonly routes: FastifyPluginAsyncZod;
  readonly jobs: {
    /** `creator_tasks.suggestion_decided`: her gesture on an idea's shoot, its content request or its decline (VEI-01 d2). */
    followDecision(decision: JobPayload<'creator_tasks.suggestion_decided'>): Promise<void>;
    /** `content_drops.drop_received`: her drop for an idea's content request, the idea `deposited` (VEI-01 d3). */
    followDeposit(received: JobPayload<'content_drops.drop_received'>): Promise<void>;
  };
}

export interface TrendsDeps {
  /** Application role: a pasted link and a reading under the person's own policies. */
  readonly db: Database;
  /** Owner role: `extension_links`, out of the application role's reach (migration 0100). */
  readonly adminDb: Database;
  readonly requireRole: RequireRole;
  /** The app's LLM gateway: the vision of a marked post's captures, a trend watch call (ADR 0060 § 7). */
  readonly gateway: Pick<LlmGateway, 'describeTrendCaptures'>;
  /** Her active persona's limits, null without one: what a corrected idea is read against (ADR 0056 § 1). */
  readonly limitsOf: (creatorId: CreatorId) => Promise<PersonaLimits | null>;
  /** The agenda's door for a validated idea (VEI-01 d): the trend watch writes no table of hers. */
  readonly agenda: Pick<CreatorTasksModule, 'suggestShoot'>;
  /** The content request's door for a shoot she accepted (VEI-01 d2). */
  readonly contentDrops: Pick<ContentDropsModule, 'requestFromIdea'>;
}

export function createTrendsModule(deps: TrendsDeps): TrendsModule {
  const follow = {
    ideas: createDrizzleIdeaFollowStore(deps.adminDb),
    requestFromIdea: (request: IdeaContentRequest) => deps.contentDrops.requestFromIdea(request),
  };
  return {
    name: 'trends',
    routes: createTrendRoutes(
      {
        signals: createDrizzleSignalStore(deps.db),
        links: createDrizzleExtensionLinkStore(deps.adminDb),
        readings: createDrizzleReadingStore(deps.db),
        vision: createGatewayCaptureVision(deps.gateway),
      },
      {
        ideas: createDrizzleIdeaStore(deps.db),
        limitsOf: deps.limitsOf,
        suggestShoot: deps.agenda.suggestShoot,
      },
      deps.requireRole,
    ),
    jobs: {
      followDecision: (decision) => followDecision(follow, decision),
      followDeposit: (received) => followDeposit(follow, received),
    },
  };
}
