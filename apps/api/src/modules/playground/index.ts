/** Public entry point of the `playground` module (ADR 0002): the training screen's API (P3-06). */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_LLM_CONFIG, loadPrompt, type LlmGateway } from '@nirvana/llm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import {
  activePersonaForModels,
  createAlertTester,
  createJsonlCalibrationStore,
  readPersonaFile,
  type CalibrationRecord,
  type ActivePersonaSource,
  type CalibrationStore,
  type PersonaForModels,
} from '../agent/index';

import { createPlaygroundService } from './application/playground-service';
import { createPlaygroundEngine } from './infra/engine';
import { createPlaygroundGateway, createVoiceVariant, type PlaygroundGatewayDeps } from './infra/gateways';
import { createPlaygroundRoutes, type PlaygroundRoutesOptions } from './infra/routes';

export { FAN_PRESETS, findPreset } from './domain/fan-presets';
export { ratingRecord } from './infra/engine';
export { createPlaygroundGateway, createVoiceVariant } from './infra/gateways';
export { readPersonaFile, withExamples } from '../agent/index';
export { createPlaygroundSession, type PlaygroundFollowUp, type PlaygroundTurn } from './infra/session';

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
}

export function createPlaygroundModule(deps: PlaygroundDeps): PlaygroundModule {
  const gateway = deps.gateway ?? createPlaygroundGateway(deps);
  const version = {
    voicePrompt: loadPrompt('voice').header.version,
    voiceModel: DEFAULT_LLM_CONFIG.roles.voice.model,
  };
  const service = createPlaygroundService(() =>
    createPlaygroundEngine({
      gateway,
      gatewayForVoice: deps.gatewayForVoice ?? ((model) => createVoiceVariant(deps, model)),
      persona: deps.persona,
      store: deps.store,
      records: deps.records,
      version,
      sessionId: `api-${randomUUID()}`,
      usdPerEur: DEFAULT_LLM_CONFIG.dailyBudget.usdPerEur,
      ...(deps.creatorId !== undefined && { creatorId: deps.creatorId }),
      ...(deps.timeZone !== undefined && { timeZone: deps.timeZone }),
      ...(deps.now !== undefined && { now: deps.now }),
    }),
  );
  const now = deps.now ?? (() => new Date());
  const alertTester = createAlertTester({
    gateway,
    personaOf: (creatorId) => activePersonaForModels(deps.activePersona, creatorId, now()),
  });
  return {
    name: 'playground',
    routes: (options) => createPlaygroundRoutes(service, alertTester, options),
  };
}

export interface PlaygroundStartOptions extends PlaygroundGatewayDeps {
  readonly gateway: LlmGateway;
  /** A persona YAML (PersonaSchema); the real one lives outside the repository (ADR 0010). */
  readonly personaPath: string;
  /** Where the ratings are kept, outside the repository, until a table exists. */
  readonly trainingDir: string;
  readonly creatorId?: () => Promise<string | null>;
  readonly activePersona: ActivePersonaSource;
}

/** Reads the persona and the ratings kept so far, then builds the module. Throws when the persona is unreadable. */
export async function startPlaygroundModule(options: PlaygroundStartOptions): Promise<PlaygroundModule> {
  const today = new Date().toISOString().slice(0, 10);
  const persona = readPersonaFile(await readFile(options.personaPath, 'utf8'), 'Messa', today);
  const store = createJsonlCalibrationStore(join(options.trainingDir, 'ratings.jsonl'));
  return createPlaygroundModule({ ...options, persona, store, records: [...(await store.list())] });
}
