import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CreatorIdSchema,
  StoredPersonaSchema,
  PersonaVersionIdSchema,
  type AgencyStyleContent,
} from '@impera/contracts';
import type { BrainInput, VoiceInput } from '@impera/llm';
import type { preValidationAsyncHookHandler } from 'fastify';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { testConfig } from '../../../../__tests__/support/config';
import { fakeGateway, type GatewaySeen } from '../../../../__tests__/support/llm';
import { createLogger } from '../../../../logger';
import { buildServer } from '../../../../server';
import { readPersonaFile, startDraftComposer, type CalibrationStore } from '../../../agent/index';
import { createPlaygroundModule } from '../../index';

/**
 * Audit du 27/11 : the playground and the simulated fans prepare her turn beside `draft-composer`, by hand, and that
 * copy had drifted (base style, register, kept language, window). Here the same message of the same fan, on the same
 * version of hers and the same base style, goes through both: what her brain and her voice are asked must be the same.
 * A field given on one side only fails here; a difference that is meant goes in `without`, with its reason.
 */

/** The demo persona (ADR 0010: never a real one), the one the playground, the evals and the simulated fans play. */
const DEMO_YAML = readFileSync(
  fileURLToPath(new URL('../../../../../../../personas/demo/v0.7.0.yaml', import.meta.url)),
  'utf8',
);
const DEMO = StoredPersonaSchema.parse(parse(DEMO_YAML));
const CREATOR = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c1');
const VERSION = PersonaVersionIdSchema.parse('0199f2a0-0000-7000-8000-0000000000e3');
const NOW = new Date('2026-10-17T10:00:00Z');

/** An invented base style of the agency, with a form of its own: both sides must read it (ADR 0173). */
const BASE_STYLE: AgencyStyleContent = {
  privateStyle: 'Phrases courtes, jamais de majuscule en début de bulle.',
  publicStyle: 'Sobre.',
  form: { capitalization: 'lowercase', strip_final_period: true },
};

/**
 * What differs on purpose, and only that: the trace names a draft in production and nothing in the playground.
 * `toEqual` reads a key set to `undefined` as absent.
 */
const without = <T extends object>(input: T): T & { readonly trace: undefined } => ({
  ...input,
  trace: undefined,
});

const ownerOnly: preValidationAsyncHookHandler = async (request) => {
  request.user = {
    id: 'charles',
    email: 'charles@example.test',
    name: 'charles',
    role: 'owner',
    creatorIds: [],
    routedCreatorIds: [],
    shiftCreatorIds: [],
  };
  request.membership = null;
  await Promise.resolve();
};

/** One message of his through the playground, on her version: what the models were asked. */
async function viaPlayground(text: string, spentCents = 0): Promise<GatewaySeen> {
  const seen: GatewaySeen = { voiceCalls: 0, traces: [], brainInputs: [], voiceInputs: [] };
  const store: CalibrationStore = { append: () => Promise.resolve(), list: () => Promise.resolve([]) };
  const stored = { id: VERSION, version: '0.7.0', creatorName: 'Elena', persona: DEMO };
  const playground = createPlaygroundModule({
    credentials: {},
    log: { append: () => undefined, since: () => [] },
    persona: readPersonaFile(DEMO_YAML, 'Elena', '2026-10-17'),
    activePersona: () => Promise.resolve(stored),
    personaVersion: (creatorId, versionId) =>
      Promise.resolve(creatorId === CREATOR && versionId === VERSION ? stored : null),
    baseStyleOf: () => Promise.resolve(BASE_STYLE),
    store,
    records: [],
    gateway: fakeGateway({}, seen),
    now: () => NOW,
  });
  const config = testConfig();
  const app = await buildServer({
    config,
    logger: createLogger(config),
    routes: [playground.routes({ guard: ownerOnly })],
    readiness: () =>
      Promise.resolve({ isReady: true, checks: { database: true, migrations: true, worker: true } }),
  });
  const headers = { origin: config.WEB_ORIGIN };
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/v1/playground${url}`, headers, payload });
  const patch = (url: string, payload: object) =>
    app.inject({ method: 'PATCH', url: `/v1/playground${url}`, headers, payload });
  expect(
    (await post('/persona', { kind: 'version', creatorId: CREATOR, versionId: VERSION })).statusCode,
  ).toBe(200);
  if (spentCents > 0) await patch('/situation', { spentCents });
  const sent = await post('/messages', { text });
  expect(sent.statusCode, sent.body).toBe(200);
  await app.close();
  return seen;
}

/** The same message of a real fan, through her drafts' composer. */
async function viaProduction(text: string, spentMinor = 0): Promise<GatewaySeen> {
  const seen: GatewaySeen = { voiceCalls: 0, traces: [], brainInputs: [], voiceInputs: [] };
  const stored = { id: VERSION, creatorName: 'Elena', persona: DEMO };
  await startDraftComposer({
    gateway: fakeGateway({}, seen),
    activePersona: () => Promise.resolve(stored),
    timeZoneOf: () => Promise.resolve('Europe/Paris'),
    baseStyleOf: () => Promise.resolve(BASE_STYLE),
  }).compose({
    creatorId: CREATOR,
    conversationId: 'conversation-1',
    fanId: 'fan-1',
    draftId: 'draft-1',
    correlationId: 'correlation-1',
    now: NOW,
    history: [{ direction: 'inbound', text, at: NOW }],
    fan: {
      notes: [],
      spentMinor,
      firstMessageAt: NOW,
      ...(spentMinor >= 50_000 && { tier: 'whale' as const }),
    },
    fanAvailability: null,
  });
  return seen;
}

const brainOf = (seen: GatewaySeen): BrainInput | undefined => seen.brainInputs?.at(-1);
const voiceOf = (seen: GatewaySeen): VoiceInput | undefined => seen.voiceInputs?.at(-1);

describe('the playground and her real drafts (audit du 27/11)', () => {
  it('ask her brain and her voice the same things for the same message, base style and form included', async () => {
    const [playground, production] = await Promise.all([
      viaPlayground('Salut toi, je viens de m’abonner'),
      viaProduction('Salut toi, je viens de m’abonner'),
    ]);
    const brain = brainOf(production);
    const voice = voiceOf(production);
    if (brain === undefined || voice === undefined) throw new Error('production asked no model');
    expect(without(brainOf(playground) ?? {})).toEqual(without(brain));
    expect(without(voiceOf(playground) ?? {})).toEqual(without(voice));
    // What the copy had lost: the base style reaches her voice on both sides.
    expect(voice.agencyStyle?.privateStyle).toBe(BASE_STYLE.privateStyle);
  });

  it('writes to a whale as her drafts do, from what he spent', async () => {
    const [playground, production] = await Promise.all([
      viaPlayground('Coucou ma belle, t’as du nouveau pour moi ?', 60_000),
      viaProduction('Coucou ma belle, t’as du nouveau pour moi ?', 60_000),
    ]);
    const voice = voiceOf(production);
    if (voice === undefined) throw new Error('production asked no voice');
    expect(without(voiceOf(playground) ?? {})).toEqual(without(voice));
  });
});
