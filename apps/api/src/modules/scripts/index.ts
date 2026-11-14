/** Public entry point of the `scripts` module (SC-01, ADR 0056). Other modules import this file only. */
import type { CreatorId, ScriptStructureVersion, ScriptVariantLetter, ShotMoment } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { askScripts, type AskScriptsRun } from './application/ask-scripts';
import { creatorQueue, queuedDigest, type QueuedDigest, type ScriptsReader } from './application/reads';
import { cardContent, cardSvg } from './domain/cards';
import type { LimitsOf, RasterizeCard, ScriptRequests, ScriptStructureStore } from './domain/ports';
import { createCardRasterizer } from './infra/card-rasterizer';
import { createDrizzleCadenceStore } from './infra/db/cadence-store';
import { createDrizzleScriptStructureStore } from './infra/db/structure-store';
import { createFrozenVersionReader, createRequestFreezer } from './infra/db/version-reader';
import { createScriptRoutes, type RequireRole } from './infra/http/routes';

export interface ScriptsModule {
  readonly name: 'scripts';
  /** The agency's structures and each creator's queue; `freeze` is what a request (SC-02) will call. */
  readonly structures: ScriptStructureStore;
  /** A frozen version by its id, whoever reads it (SC-02 lot b): what her script drop shoots. `null` when not frozen. */
  frozenVersion(versionId: string): Promise<ScriptStructureVersion | null>;
  /**
   * A card of a frozen version, as the SVG her script shows (SC-02 lot b2): the same drawing as the library's, never
   * rasterised. `null` for a version not frozen, or a segment or series it does not have. `moment`, the one her request
   * fixed, is what the card says; `null` keeps the structure's.
   */
  frozenCard(
    versionId: string,
    segmentKey: string,
    variant: ScriptVariantLetter | null,
    moment: ShotMoment | null,
  ): Promise<string | null>;
  /**
   * A card of a frozen version as the folder's PNG (SC-03, ADR 0056 § 3): the `folder` format, rasterised, which goes
   * at `00` of its series in the script's folder. `null` like `frozenCard`.
   */
  frozenFolderCard(
    versionId: string,
    segmentKey: string,
    variant: ScriptVariantLetter | null,
    moment: ShotMoment | null,
  ): Promise<Uint8Array | null>;
  /** The latest version frozen for a script asked by hand (SC-02 lot b), by an owner or a manager; `null` when archived. */
  freezeForRequest(structureId: string, userId: string): Promise<string | null>;
  /**
   * The agency's reads of a creator's scripts, bounded by her id, who reads checked in `application/` (ADR 0026 § 1):
   * what the MCP server lists (ADR 0105 § 4, `scripts_list`). Her queue in order, names and sizes, never a step's text;
   * `null` for a creator who does not exist or a reader who may not read her queue.
   */
  readonly reads: {
    queue(creatorId: CreatorId, reader: ScriptsReader): Promise<readonly QueuedDigest[] | null>;
  };
  /** Mounted under `/v1` by the server: `/script-structures` (and their cards), each creator's `/script-queue` and `/script-cadence`. */
  readonly routes: FastifyPluginAsyncZod;
  readonly jobs: {
    /**
     * `scripts.ask_scripts`, each hour (SC-02): the scripts due asked of each creator. Counts only; `onFailure` hears
     * each creator whose run failed, with its cause, for the log.
     */
    askScripts(now: Date, onFailure?: (creatorId: CreatorId, error: unknown) => void): Promise<AskScriptsRun>;
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
  const frozenVersion = createFrozenVersionReader(deps.adminDb);
  const rasterize = deps.rasterizeCard ?? createCardRasterizer(deps.cardFontsDir);
  return {
    name: 'scripts',
    structures,
    frozenVersion,
    frozenCard: async (versionId, segmentKey, variant, moment) => {
      const version = await frozenVersion(versionId);
      if (version === null) return null;
      const content = cardContent(version, segmentKey, variant === null ? { moment } : { variant, moment });
      return content === null ? null : cardSvg(content, 'card');
    },
    frozenFolderCard: async (versionId, segmentKey, variant, moment) => {
      const version = await frozenVersion(versionId);
      if (version === null) return null;
      const content = cardContent(version, segmentKey, variant === null ? { moment } : { variant, moment });
      return content === null ? null : rasterize(cardSvg(content, 'folder'));
    },
    freezeForRequest: createRequestFreezer(deps.adminDb),
    reads: {
      queue: async (creatorId, reader) =>
        (await creatorQueue(structures, reader, creatorId))?.map(queuedDigest) ?? null,
    },
    routes: createScriptRoutes(structures, deps.limitsOf, deps.requireRole, rasterize, {
      store: cadences,
      requests: deps.requests,
    }),
    jobs: {
      askScripts: (now, onFailure) =>
        askScripts(
          {
            cadences,
            requests: deps.requests,
            limitsOf: deps.limitsOf,
            ...(onFailure === undefined ? {} : { onFailure }),
          },
          now,
        ),
    },
  };
}
