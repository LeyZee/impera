/** Public entry point of the `creator-decisions` module (ADR 0162, « À décider »). Other modules import this file only. */
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { DecisionAsking } from './domain/ports';
import { createDrizzleDecisionAsking, createDrizzleDecisionStore } from './infra/db/decision-store';
import { createDecisionRoutes, type RequireRole } from './infra/http/routes';

export type { AskedDecision, DecisionAsking } from './domain/ports';

export interface CreatorDecisionsModule {
  readonly name: 'creator-decisions';
  /** Mounted under `/v1`: her `/creator-space/decisions`, the owner's `/creators/:creatorId/decisions`. */
  readonly routes: FastifyPluginAsyncZod;
  /** The door of the code that asks her something: one creator at a time, once per subject. */
  readonly asking: DecisionAsking;
}

export interface CreatorDecisionsDeps {
  /** Application role: her account, the owner's, and the code that asks under its own name. */
  readonly db: Database;
  readonly requireRole: RequireRole;
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createCreatorDecisionsModule(deps: CreatorDecisionsDeps): CreatorDecisionsModule {
  return {
    name: 'creator-decisions',
    routes: createDecisionRoutes({
      store: createDrizzleDecisionStore(deps.db),
      requireRole: deps.requireRole,
      ...(deps.clock !== undefined && { clock: deps.clock }),
    }),
    asking: createDrizzleDecisionAsking(deps.db),
  };
}
