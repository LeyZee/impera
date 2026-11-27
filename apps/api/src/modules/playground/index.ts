/** Public entry point of the `playground` module (ADR 0002): the training screen's API (P3-06). */
import { randomUUID } from 'node:crypto';
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

import {
  CreatorIdSchema,
  PersonaVersionIdSchema,
  type CreatorId,
  type PersonaVersionId,
  type PlaygroundState,
  type StoredPersona,
} from '@impera/contracts';
import { DEFAULT_LLM_CONFIG, loadPrompt, type LlmGateway } from '@impera/llm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import {
  activePersonaForModels,
  createAlertTester,
  createJsonlCalibrationStore,
  guardSettingsOf,
  pickVoiceExamples,
  readPersonaFile,
  type CalibrationRecord,
  type ActivePersonaSource,
  type CalibrationStore,
  type PersonaForModels,
  type VoiceExample,
} from '../agent/index';

import { createMemoryDesireMarkStore, type DesireMarkStore } from './application/desire-marks';
import { PlaygroundPersonaNotFound } from './application/engine';
import { createPlaygroundService, type Trainer } from './application/playground-service';
import { createVoiceBankView } from './infra/bank';
import type { Catalogue, HerScriptsSource } from './infra/catalogue';
import { importRatings, type RatingImport, type VoiceBankStore } from './infra/db/rating-store';
import { createPlaygroundEngine } from './infra/engine';
import { createPlaygroundGateway, createVoiceVariant, type PlaygroundGatewayDeps } from './infra/gateways';
import { createPlaygroundRoutes, type PlaygroundRoutesOptions } from './infra/routes';

export { FAN_PRESETS, findPreset } from './domain/fan-presets';
export { ratingRecord } from './infra/engine';
export { createPlaygroundGateway, createVoiceVariant } from './infra/gateways';
export { readPersonaFile, withExamples } from '../agent/index';
export { createPlaygroundSession, type PlaygroundFollowUp, type PlaygroundTurn } from './infra/session';
export { createDbDesireMarkStore } from './infra/db/desire-mark-store';
export type { HerCatalogue, HerScriptsSource, PlaygroundScript, ShownMedia } from './infra/catalogue';
export {
  createDbCalibrationStore,
  createDbVoiceBankStore,
  createDbVoiceExampleBank,
  importRatings,
} from './infra/db/rating-store';
export type { DesireMarkRecord } from './application/desire-marks';

/** One of her stored versions with her name, as `persona.versions.version` answers it (matched by shape). */
type PersonaVersionSource = (
  creatorId: CreatorId,
  versionId: PersonaVersionId,
) => Promise<{
  readonly id: string;
  readonly version: string;
  readonly creatorName: string;
  readonly persona: StoredPersona;
} | null>;

type PlayedVersion = NonNullable<PlaygroundState['persona']['played']>;

export interface PlaygroundModule {
  readonly name: 'playground';
  /**
   * `/v1/playground` with its persona, and `POST /v1/alerts/test` (P4-01) with the active persona of the creator it
   * names (recette M13), behind the guard given here.
   */
  readonly routes: (options: PlaygroundRoutesOptions) => FastifyPluginAsyncZod;
}

export interface PlaygroundDeps extends PlaygroundGatewayDeps {
  readonly persona: PersonaForModels;
  /** Her active persona version (`persona` module): « Tester » an alert reads the phrase with it, as her drafts do. */
  readonly activePersona: ActivePersonaSource;
  /**
   * One of her versions, active or not (`persona.versions.version`, recette PRO-21): the trainer talks to it before
   * activating it. Absent: only the invented persona plays.
   */
  readonly personaVersion?: PersonaVersionSource;
  /**
   * Her bio on her platform profile as the poll last read it (ADR 0154 § 7): her version played reads it as her real
   * fans' drafts do. Absent, or the invented persona: none.
   */
  readonly profileBioOf?: (creatorId: string) => Promise<string | null>;
  readonly store: CalibrationStore;
  /** The ratings already kept: the rate starts from them and the corrections come back as voice examples. */
  readonly records: CalibrationRecord[];
  readonly timeZone?: string;
  readonly now?: () => Date;
  /** The creator the ratings belong to (the only one there is); ratings stay unassigned without it. */
  readonly creatorId?: () => Promise<string | null>;
  /** The app's one gateway (or a fake in tests); built from the deps otherwise, as in the terminal. */
  readonly gateway?: LlmGateway;
  /** Tests only: fake gateways for the comparison. */
  readonly gatewayForVoice?: (voiceModel: string) => LlmGateway | undefined;
  /** The owner's marks on the desire score (ADR 0103 § 6), in `desire_marks`; in memory without a database. */
  readonly desireMarks?: DesireMarkStore;
  /** Her own scripts (ADR 0103 § 15), sold from when one of her versions is played; the trial scripts without. */
  readonly herScripts?: HerScriptsSource;
  /**
   * Her bank of examples, read as her drafts read it (ADR 0102 § 2): what the trainer sees is what a fan receives.
   * Absent (no database): chosen from the ratings kept in memory.
   */
  readonly voiceExamplesOf?: (creatorId: string) => Promise<readonly VoiceExample[]>;
  /** Her bank as Entraîner lists it and « Retirer » (ADR 0102 § 5); absent without a database. */
  readonly bank?: VoiceBankStore;
}

/** Her catalogue as a session reads it: hers, or why none of hers can be played. */
const herCatalogue =
  (source: HerScriptsSource, creatorId: string, trainer: Trainer) => async (): Promise<Catalogue> => {
    const read = await source(creatorId, trainer);
    return read.kind === 'ready'
      ? {
          source: 'hers',
          scripts: read.scripts,
          unavailable: read.scripts.length === 0 ? 'none_ready' : null,
        }
      : { source: 'hers', scripts: [], unavailable: read.reason };
  };

export function createPlaygroundModule(deps: PlaygroundDeps): PlaygroundModule {
  const gateway = deps.gateway ?? createPlaygroundGateway(deps);
  const version = {
    voicePrompt: loadPrompt('voice').header.version,
    voiceModel: DEFAULT_LLM_CONFIG.roles.voice.model,
  };
  const now = deps.now ?? (() => new Date());
  const desireMarks = deps.desireMarks ?? createMemoryDesireMarkStore();
  const engineFor = (
    persona: PersonaForModels,
    played?: PlayedVersion,
    trainer?: Trainer,
    examples?: readonly VoiceExample[],
    profileBio: string | null = null,
  ) =>
    createPlaygroundEngine({
      gateway,
      ...(profileBio !== null && { profileBio }),
      gatewayForVoice: deps.gatewayForVoice ?? ((model) => createVoiceVariant(deps, model)),
      persona,
      store: deps.store,
      records: deps.records,
      version,
      sessionId: `api-${randomUUID()}`,
      usdPerEur: DEFAULT_LLM_CONFIG.dailyBudget.usdPerEur,
      desireMarks,
      ...(played !== undefined && { played }),
      // Her own scripts when one of her versions is played, read as the trainer reads them; the trial ones otherwise.
      ...(played !== undefined &&
        trainer !== undefined &&
        deps.herScripts !== undefined && {
          herScripts: herCatalogue(deps.herScripts, played.creatorId, trainer),
        }),
      ...(examples !== undefined && { voiceExamples: examples }),
      ...(deps.creatorId !== undefined && { creatorId: deps.creatorId }),
      ...(deps.timeZone !== undefined && { timeZone: deps.timeZone }),
      ...(deps.now !== undefined && { now: deps.now }),
    });
  const service = createPlaygroundService({
    invented: () => engineFor(deps.persona),
    ofVersion: async ({ creatorId, versionId }, trainer) => {
      const stored = (await deps.personaVersion?.(creatorId, versionId)) ?? null;
      if (stored === null) throw new PlaygroundPersonaNotFound();
      // Read as her drafts read her active one: her name for a placeholder first name, her day for her age.
      const persona = await activePersonaForModels(() => Promise.resolve(stored), creatorId, now());
      if (persona === null) throw new PlaygroundPersonaNotFound();
      // Her bio as her real fans' drafts read it; a failed read plays without it, as a draft would.
      const profileBio = await (deps.profileBioOf?.(creatorId) ?? Promise.resolve(null)).catch(() => null);
      const bank = await deps.voiceExamplesOf?.(creatorId);
      const examples =
        bank === undefined ? undefined : pickVoiceExamples(bank, guardSettingsOf(persona), bank.length);
      const engine = engineFor(
        persona,
        { creatorId, versionId, version: stored.version },
        trainer,
        examples,
        profileBio,
      );
      await engine.readScripts();
      return engine;
    },
  });
  const alertTester = createAlertTester({
    gateway,
    personaOf: (creatorId) => activePersonaForModels(deps.activePersona, creatorId, now()),
  });
  const bank =
    deps.bank === undefined
      ? undefined
      : createVoiceBankView({
          store: deps.bank,
          guardsOf: async (creatorId, versionId) => {
            const stored = await deps.personaVersion?.(
              CreatorIdSchema.parse(creatorId),
              PersonaVersionIdSchema.parse(versionId),
            );
            if (stored === undefined || stored === null) return null;
            const persona = await activePersonaForModels(() => Promise.resolve(stored), creatorId, now());
            return persona === null ? null : guardSettingsOf(persona);
          },
          now,
        });
  return {
    name: 'playground',
    routes: (options) => createPlaygroundRoutes(service, alertTester, desireMarks, options, bank),
  };
}

export interface PlaygroundStartOptions extends PlaygroundGatewayDeps {
  readonly gateway: LlmGateway;
  /** A persona YAML (`StoredPersonaSchema`, either format); the real one lives outside the repository (ADR 0010). */
  readonly personaPath: string;
  /** Where the ratings were kept before the table, outside the repository: read once to import them (AGE-06). */
  readonly trainingDir: string;
  /** The ratings' table (ADR 0103); without it, the JSON lines of `trainingDir`, as the terminal playground. */
  readonly ratings?: CalibrationStore;
  /** Told how the one-time import of the JSON lines went. */
  readonly onImport?: (result: RatingImport) => void;
  readonly creatorId?: () => Promise<string | null>;
  readonly activePersona: ActivePersonaSource;
  readonly personaVersion?: PersonaVersionSource;
  readonly profileBioOf?: (creatorId: string) => Promise<string | null>;
  readonly desireMarks?: DesireMarkStore;
  readonly herScripts?: HerScriptsSource;
  readonly voiceExamplesOf?: NonNullable<PlaygroundDeps['voiceExamplesOf']>;
  readonly bank?: VoiceBankStore;
}

/** Reads the persona and the ratings kept so far, then builds the module. Throws when the persona is unreadable. */
export async function startPlaygroundModule(options: PlaygroundStartOptions): Promise<PlaygroundModule> {
  const today = new Date().toISOString().slice(0, 10);
  const persona = readPersonaFile(await readFile(options.personaPath, 'utf8'), 'Messa', today);
  const linesPath = join(options.trainingDir, 'ratings.jsonl');
  const lines = createJsonlCalibrationStore(linesPath);
  const store = options.ratings ?? lines;
  if (options.ratings !== undefined) {
    const result = await importRatings(lines, options.ratings);
    options.onImport?.(result);
    // Imported once, then renamed, never deleted (ADR 0103 § 2): kept as it was while the table refused any.
    if (result.read > 0 && result.refused === 0) {
      // A rename that fails changes nothing: the import adds nothing the next time.
      await rename(linesPath, `${linesPath}.imported-${String(Date.now())}`).catch(() => undefined);
    }
  }
  return createPlaygroundModule({ ...options, persona, store, records: [...(await store.list())] });
}
