/** Public entry point of the `creator-limits` module (Charles, 21/11). Other modules import this file only. */
import type { CreatorId, CreatorStop } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { absenceOn } from './domain/limits';
import { createDrizzleLimitStore } from './infra/db/store';
import { createLimitRoutes, type RequireRole } from './infra/http/routes';

export interface CreatorLimitsModule {
  readonly name: 'creator-limits';
  /** Mounted under `/v1`: her `/creator-space/limits`, `…/absences`, `…/stops`; her team's `/creators/:id/limits`. */
  readonly routes: FastifyPluginAsyncZod;
  /** What the agent and « Sur mesure » read of her, read-only, under her RLS (`withTenant`). */
  readonly reads: CreatorLimitsReads;
}

/**
 * Her absence and what she no longer does, for the server's own readers (Charles, 26/11: while she is away the AI
 * chats but promises nothing that needs her). The caller has already decided it may read her: these never check a
 * person, they open her tenant only.
 */
interface CreatorLimitsReads {
  /** She is away on `at`'s day in her zone, until `until` (her last day away, included); `null` when she is here. */
  creatorAbsence(creatorId: CreatorId, at: Date): Promise<{ readonly until: string } | null>;
  /** What she no longer does, the latest first; taken back lines are never listed. */
  creatorNoLongerDoes(creatorId: CreatorId): Promise<readonly CreatorStop[]>;
}

export interface CreatorLimitsDeps {
  readonly db: Database;
  readonly requireRole: RequireRole;
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createCreatorLimitsModule(deps: CreatorLimitsDeps): CreatorLimitsModule {
  const store = createDrizzleLimitStore(deps.db);
  const clock = deps.clock ?? (() => new Date());
  return {
    name: 'creator-limits',
    routes: createLimitRoutes(store, deps.requireRole, deps.clock),
    reads: {
      creatorAbsence: async (creatorId, at) => absenceOn(await store.ofCreator(creatorId, at)),
      creatorNoLongerDoes: async (creatorId) => (await store.ofCreator(creatorId, clock())).stops,
    },
  };
}
