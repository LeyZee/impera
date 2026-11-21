/** Public entry point of the `creator-limits` module (Charles, 21/11). Other modules import this file only. */
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createDrizzleLimitStore } from './infra/db/store';
import { createLimitRoutes, type RequireRole } from './infra/http/routes';

export interface CreatorLimitsModule {
  readonly name: 'creator-limits';
  /** Mounted under `/v1`: her `/creator-space/limits`, `…/absences`, `…/stops`; her team's `/creators/:id/limits`. */
  readonly routes: FastifyPluginAsyncZod;
}

export interface CreatorLimitsDeps {
  readonly db: Database;
  readonly requireRole: RequireRole;
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createCreatorLimitsModule(deps: CreatorLimitsDeps): CreatorLimitsModule {
  return {
    name: 'creator-limits',
    routes: createLimitRoutes(createDrizzleLimitStore(deps.db), deps.requireRole, deps.clock),
  };
}
