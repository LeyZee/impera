/** Public entry point of the `scripts` module (SC-01, ADR 0056). Other modules import this file only. */
import type { ScriptStructureVersion } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { askScripts, type AskScriptsRun } from './application/ask-scripts';
import type { LimitsOf, RasterizeCard, ScriptRequests, ScriptStructureStore } from './domain/ports';
import { createCardRasterizer } from './infra/card-rasterizer';
import { createDrizzleCadenceStore } from './infra/db/cadence-store';
import { createDrizzleScriptStructureStore } from './infra/db/structure-store';
import { createFrozenVersionReader } from './infra/db/version-reader';
import { createScriptRoutes, type RequireRole } from './infra/http/routes';

export interface ScriptsModule {
  readonly name: 'scripts';
  /** The agency's structures and each creator's queue; `freeze` is what a request (SC-02) will call. */
  readonly structures: ScriptStructureStore;
  /** A frozen version by its id, whoever reads it (SC-02 lot b): what her script drop shoots. `null` when not frozen. */
  frozenVersion(versionId: string): Promise<ScriptStructureVersion | null>;
  /** Mounted under `/v1` by the server: `/script-structures` (and their cards), each creator's `/script-queue` and `/script-cadence`. */
  readonly routes: FastifyPluginAsyncZod;
  readonly jobs: {
    /** `scripts.ask_scripts`, each hour (SC-02): the scripts due asked of each creator. Counts only. */
    askScripts(now: Date): Promise<AskScriptsRun>;
  };
}

export interface ScriptsDeps {
  /** Application role: the library under the team's policies, the queue under her RLS too. */
  readonly db: Database;
  /** Owner role: the cadence's hourly job. */
  readonly adminDb: Database;
  /** The scripts asked of her (`content-drops`, wired by the composition root). */
  readonly requests: ScriptRequests;
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
  const cadences = createDrizzleCadenceStore(deps.db, deps.adminDb);
  return {
    name: 'scripts',
    structures,
    frozenVersion: createFrozenVersionReader(deps.adminDb),
    routes: createScriptRoutes(
      structures,
      deps.limitsOf,
      deps.requireRole,
      deps.rasterizeCard ?? createCardRasterizer(deps.cardFontsDir),
      { store: cadences, requests: deps.requests },
    ),
    jobs: {
      askScripts: (now) => askScripts({ cadences, requests: deps.requests, limitsOf: deps.limitsOf }, now),
    },
  };
}
