/** Public entry point of the `scripts` module (SC-01, ADR 0056). Other modules import this file only. */
import type { Database } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { ScriptStructureStore } from './domain/ports';
import { createDrizzleScriptStructureStore } from './infra/db/structure-store';
import { createScriptRoutes, type LimitsOf, type RequireRole } from './infra/http/routes';

export interface ScriptsModule {
  readonly name: 'scripts';
  /** The agency's structures and each creator's queue; `freeze` is what a request (SC-02) will call. */
  readonly structures: ScriptStructureStore;
  /** Mounted under `/v1` by the server: `/script-structures` and each creator's `/script-queue`. */
  readonly routes: FastifyPluginAsyncZod;
}

export interface ScriptsDeps {
  /** Application role: the library under the team's policies, the queue under her RLS too. */
  readonly db: Database;
  readonly requireRole: RequireRole;
  /** Her persona's limits (`persona`, wired by the composition root): what a stage may not touch. */
  readonly limitsOf: LimitsOf;
}

export function createScriptsModule(deps: ScriptsDeps): ScriptsModule {
  const structures = createDrizzleScriptStructureStore(deps.db);
  return {
    name: 'scripts',
    structures,
    routes: createScriptRoutes(structures, deps.limitsOf, deps.requireRole),
  };
}
