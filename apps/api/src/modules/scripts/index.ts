/** Public entry point of the `scripts` module (SC-01, ADR 0056). Other modules import this file only. */
import type { CreatorId, ScriptStructureVersion, ScriptVariantLetter, ShotMoment } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { askScripts, type AskScriptsRun } from './application/ask-scripts';
import { importPlatformScripts, type ImportPlatformScriptsRun } from './application/import-platform-scripts';
import {
  creatorPlatformScripts,
  platformScriptOf,
  type PlatformScriptsReader,
  type PlatformScriptView,
} from './application/platform-script-reads';
import { creatorQueue, queuedDigest, type QueuedDigest, type ScriptsReader } from './application/reads';
import { cardContent, cardSvg } from './domain/cards';
import type {
  LimitsOf,
  PlatformScriptSource,
  RasterizeCard,
  ScriptRequests,
  ScriptStructureStore,
  VaultLinks,
} from './domain/ports';
import { createCardRasterizer } from './infra/card-rasterizer';
import { createDrizzleCadenceStore } from './infra/db/cadence-store';
import {
  createDrizzlePlatformScriptImportStore,
  createDrizzlePlatformScriptReadStore,
} from './infra/db/platform-script-store';
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
    /**
     * Her native scripts imported from the platform (ADR 0099 § 1 time 2), with their price warnings and what keeps each
     * from being offered; the owner and her active managers only. `null` for a reader who may not read her.
     */
    platformScripts(
      creatorId: CreatorId,
      reader: PlatformScriptsReader,
    ): Promise<readonly PlatformScriptView[] | null>;
    /**
     * One native script of hers, out of any person: what a job of the agent reads before sending its step (ADR 0111,
     * the reward). `null` when it is not hers.
     */
    platformScript(creatorId: CreatorId, scriptId: string): Promise<PlatformScriptView | null>;
  };
  /** Mounted under `/v1` by the server: `/script-structures` (and their cards), each creator's `/script-queue` and `/script-cadence`. */
  readonly routes: FastifyPluginAsyncZod;
  readonly jobs: {
    /**
     * `scripts.ask_scripts`, each hour (SC-02): the scripts due asked of each creator. Counts only; `onFailure` hears
     * each creator whose run failed, with its cause, for the log.
     */
    askScripts(now: Date, onFailure?: (creatorId: CreatorId, error: unknown) => void): Promise<AskScriptsRun>;
    /**
     * `scripts.import_platform_scripts` (ADR 0099 § 1 time 2): each account's native scripts mirrored from the platform.
     * Counts only; `onFailure` hears each creator whose import failed.
     */
    importPlatformScripts(
      now: Date,
      onFailure?: (creatorId: CreatorId, error: unknown) => void,
    ): Promise<ImportPlatformScriptsRun>;
  };
}

/** What the import of the native scripts reads, wired by the composition root. */
interface PlatformScriptPorts {
  /** `connectors`: the scripts the platform lists for an account; `null` when its connector reads none. */
  readonly source: PlatformScriptSource;
  /** `media`: the vault links of the account's media (`media_platform_refs`). */
  readonly vault: VaultLinks;
}

/** Until the vault's sync and the connectors' reads are wired: no account reads any script, no media is in the vault. */
const NO_PLATFORM_SCRIPTS: PlatformScriptPorts = {
  source: () => Promise.resolve(null),
  vault: () => Promise.resolve(new Map()),
};

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
  /** The platform's scripts and the vault's links; absent, the import reads nothing (see `NO_PLATFORM_SCRIPTS`). */
  readonly platformScripts?: PlatformScriptPorts;
}

export function createScriptsModule(deps: ScriptsDeps): ScriptsModule {
  const structures = createDrizzleScriptStructureStore(deps.db);
  const cadences = createDrizzleCadenceStore(deps.db, deps.adminDb);
  const frozenVersion = createFrozenVersionReader(deps.adminDb);
  const rasterize = deps.rasterizeCard ?? createCardRasterizer(deps.cardFontsDir);
  const platform = deps.platformScripts ?? NO_PLATFORM_SCRIPTS;
  const platformReads = {
    store: createDrizzlePlatformScriptReadStore(deps.db, deps.adminDb),
    vault: platform.vault,
  };
  const platformImports = createDrizzlePlatformScriptImportStore(deps.adminDb);
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
      platformScripts: (creatorId, reader) => creatorPlatformScripts(platformReads, reader, creatorId),
      platformScript: (creatorId, scriptId) => platformScriptOf(platformReads, creatorId, scriptId),
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
      importPlatformScripts: (now, onFailure) =>
        importPlatformScripts(
          {
            store: platformImports,
            source: platform.source,
            ...(onFailure === undefined ? {} : { onFailure }),
          },
          now,
        ),
    },
  };
}
