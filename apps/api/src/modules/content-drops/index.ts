/** Public entry point of the `content-drops` module (CR-06, ADR 0044, ADR 0055). Other modules import this file only. */
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createDrizzleAgencyContentStore, createDrizzleCreatorContentStore } from './infra/db/store';
import { createContentDropRoutes, type RequireRole } from './infra/http/routes';

export interface ContentDropsModule {
  readonly name: 'content-drops';
  /** Mounted under `/v1` by the server: her `/creator-space/content` and its writes, the agency's `/creators/:creatorId/…`. */
  readonly routes: FastifyPluginAsyncZod;
}

export interface ContentDropsDeps {
  /** Application role: her own account's RLS, or the team's. */
  readonly db: Database;
  readonly requireRole: RequireRole;
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createContentDropsModule(deps: ContentDropsDeps): ContentDropsModule {
  return {
    name: 'content-drops',
    routes: createContentDropRoutes(
      createDrizzleCreatorContentStore(deps.db),
      createDrizzleAgencyContentStore(deps.db),
      deps.requireRole,
      deps.clock,
    ),
  };
}
