/** Public entry point of the `scripts` module (SC-01, ADR 0056). Other modules import this file only. */
import type { Database } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { RasterizeCard, ScriptStructureStore } from './domain/ports';
import { createCardRasterizer } from './infra/card-rasterizer';
import { createDrizzleScriptStructureStore } from './infra/db/structure-store';
import { createScriptRoutes, type LimitsOf, type RequireRole } from './infra/http/routes';

export interface ScriptsModule {
  readonly name: 'scripts';
  /** The agency's structures and each creator's queue; `freeze` is what a request (SC-02) will call. */
  readonly structures: ScriptStructureStore;
  /** Mounted under `/v1` by the server: `/script-structures` (and their cards) and each creator's `/script-queue`. */
  readonly routes: FastifyPluginAsyncZod;
}

export interface ScriptsDeps {
  /** Application role: the library under the team's policies, the queue under her RLS too. */
  readonly db: Database;
  readonly requireRole: RequireRole;
  /** Her persona's limits (`persona`, wired by the composition root): what a stage may not touch. */
  readonly limitsOf: LimitsOf;
  /** The folder of the card fonts (`infra/fonts`, copied beside `dist` in the image). */
  readonly cardFontsDir: string;
  /** Tests only: another rasteriser than ffmpeg's. */
  readonly rasterizeCard?: RasterizeCard;
}

export function createScriptsModule(deps: ScriptsDeps): ScriptsModule {
  const structures = createDrizzleScriptStructureStore(deps.db);
  return {
    name: 'scripts',
    structures,
    routes: createScriptRoutes(
      structures,
      deps.limitsOf,
      deps.requireRole,
      deps.rasterizeCard ?? createCardRasterizer(deps.cardFontsDir),
    ),
  };
}
