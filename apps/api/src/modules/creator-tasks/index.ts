/** Public entry point of the `creator-tasks` module (CR-05, ADR 0042 § 3 and § 4). Other modules import this file only. */
import type { AgencySuggestion } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { ShootSuggestion } from './domain/ports';
import { createDrizzleCreatorAgendaStore } from './infra/db/agenda-store';
import { createDrizzleSuggestionStore } from './infra/db/suggestion-store';
import { createCreatorTaskRoutes, type RequireRole } from './infra/http/routes';

export type { ShootSuggestion } from './domain/ports';

export interface CreatorTasksModule {
  readonly name: 'creator-tasks';
  /** Mounted under `/v1` by the server: her `/creator-space/agenda` and its writes, the agency's `/creators/:creatorId/suggestions`. */
  readonly routes: FastifyPluginAsyncZod;
  /**
   * A shoot suggested with its sheet (VEI-01 d: an idea validated in « Idées du jour »), in her first room or undated,
   * under the owner's or an active manager's account and her agenda's rules. The trend watch writes no table of hers.
   */
  readonly suggestShoot: (
    creatorId: string,
    userId: string,
    shoot: ShootSuggestion,
    now: Date,
  ) => Promise<AgencySuggestion>;
}

export interface CreatorTasksDeps {
  /** Application role: her own account's RLS, or the team's. */
  readonly db: Database;
  readonly requireRole: RequireRole;
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createCreatorTasksModule(deps: CreatorTasksDeps): CreatorTasksModule {
  const suggestions = createDrizzleSuggestionStore(deps.db);
  return {
    name: 'creator-tasks',
    routes: createCreatorTaskRoutes(
      createDrizzleCreatorAgendaStore(deps.db),
      suggestions,
      deps.requireRole,
      deps.clock,
    ),
    suggestShoot: (creatorId, userId, shoot, now) => suggestions.suggestShoot(creatorId, userId, shoot, now),
  };
}
