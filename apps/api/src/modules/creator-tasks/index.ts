/** Public entry point of the `creator-tasks` module (CR-05, ADR 0042 § 3 and § 4). Other modules import this file only. */
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createDrizzleCreatorAgendaStore } from './infra/db/agenda-store';
import { createDrizzleSuggestionStore } from './infra/db/suggestion-store';
import { createCreatorTaskRoutes, type RequireRole } from './infra/http/routes';

export interface CreatorTasksModule {
  readonly name: 'creator-tasks';
  /** Mounted under `/v1` by the server: her `/creator-space/agenda` and its writes, the agency's `/creators/:creatorId/suggestions`. */
  readonly routes: FastifyPluginAsyncZod;
}

export interface CreatorTasksDeps {
  /** Application role: her own account's RLS, or the team's. */
  readonly db: Database;
  readonly requireRole: RequireRole;
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createCreatorTasksModule(deps: CreatorTasksDeps): CreatorTasksModule {
  return {
    name: 'creator-tasks',
    routes: createCreatorTaskRoutes(
      createDrizzleCreatorAgendaStore(deps.db),
      createDrizzleSuggestionStore(deps.db),
      deps.requireRole,
      deps.clock,
    ),
  };
}
