import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  AlertTestResultSchema,
  ApiErrorSchema,
  CreatorIdSchema,
  DesireMarksSchema,
  PersonaSchema,
  PersonaVersionIdSchema,
  PlaygroundAnswerSchema,
  PlaygroundRatingResultSchema,
  PlaygroundStateSchema,
} from '@impera/contracts';
import {
  DEFAULT_LLM_CONFIG,
  type Brief,
  type HealthReport,
  type LlmGateway,
  type VoiceOutput,
} from '@impera/llm';
import type { LightMyRequestResponse, preValidationAsyncHookHandler } from 'fastify';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { testConfig } from '../../../../__tests__/support/config';
import { createLogger } from '../../../../logger';
import { buildServer } from '../../../../server';
import {
  FRENCH_ONLY,
  type CalibrationRecord,
  type CalibrationStore,
  type VoiceExample,
} from '../../../agent/index';
import { createPlaygroundModule, type HerScriptsSource } from '../../index';
import type { VoiceBankStore } from '../db/rating-store';

const BRIEF: Brief = {
  intent: 'small_talk',
  sentiment: 'positive',
  factsProposed: [],
  kycMissing: ['first_name'],
  risks: [],
  action: 'reply',
  replyBrief: 'Lui demander son prénom.',
  toneHints: [],
};

const META = {
  provider: 'xai',
  model: 'grok-4.7',
  isFallback: false,
  latencyMs: 800,
  costUsd: 0.002,
  promptHash: 'h',
} as const;

function health(hasKey: boolean): HealthReport {
  return {
    state: hasKey ? 'ok' : 'down',
    at: new Date(),
    roles: [
      {
        role: 'voice',
        state: hasKey ? 'ok' : 'down',
        active: { provider: 'xai', model: 'grok-4.7', label: 'Grok 4.7' },
        hasKey,
        isOnFallback: false,
        callsLastHour: 0,
        errorRateLastHour: 0,
        costTodayUsd: 0,
      },
    ],
    providers: [],
    costTodayUsd: 0,
    budget: { day: '2026-10-17', spentEur: 0, capEur: 20, alertAtEur: 16, state: 'ok' },
    trendWatchBudget: { day: '2026-10-17', spentEur: 0, capEur: 1, alertAtEur: 0.8, state: 'ok' },
  };
}

/** `keys.voice` can be switched off mid-test; `hold` delays the voice until the test releases it. */
interface GatewayControl {
  hasKey: boolean;
  hold?: Promise<void>;
  /** The sheets the voice was given, when the test reads them. */
  sheets?: string[];
}

function gateway(voice: VoiceOutput, control: GatewayControl = { hasKey: true }): LlmGateway {
  return {
    sense: () => Promise.reject(new Error('not used')),
    transcribe: () => Promise.reject(new Error('not used')),
    describeTrendCaptures: () => Promise.reject(new Error('not used')),
    describeDrop: () => Promise.reject(new Error('not used')),
    channelPost: () => Promise.reject(new Error('not used')),
    instagramComment: () => Promise.reject(new Error('not used')),
    proposeCaptions: () => Promise.reject(new Error('not used')),
    summarizeScript: () => Promise.reject(new Error('not used')),
    identifyScript: () => Promise.reject(new Error('not used')),
    readCard: () => Promise.reject(new Error('not used')),
    promptHashes: { creatorDrop: 'drop-v1', scriptSummary: 'summary-v1', scriptIdentity: 'identity-v1' },
    brain: () => Promise.resolve({ ok: true, value: { output: BRIEF, meta: META } }),
    voice: async (input) => {
      control.sheets?.push(input.personaSheet);
      await control.hold;
      return { ok: true, value: { output: voice, meta: META } };
    },
    health: () => health(control.hasKey),
    judge: () => Promise.reject(new Error('not used')),
    testConnection: () => Promise.reject(new Error('not used')),
  };
}

const stateOf = (response: LightMyRequestResponse) => PlaygroundStateSchema.parse(response.json());
const codeOf = (response: LightMyRequestResponse) => ApiErrorSchema.parse(response.json()).error.code;

/** Stands in for `requireRole('owner')`: the header says who asks, and the user is set as auth.ts does. */
const ownerOnly: preValidationAsyncHookHandler = async (request, reply) => {
  const id = request.headers['x-test-user'];
  if (typeof id !== 'string') {
    await reply.code(403).send({ error: 'forbidden' });
    return;
  }
  // `x-test-as`: a manager (his list in `x-test-creators`) or a chatter, as `requireRole('owner', 'operator')` lets in.
  const as = request.headers['x-test-as'];
  const list = request.headers['x-test-creators'];
  const operator = as === 'manager' || as === 'chatter';
  request.user = {
    id,
    email: `${id}@example.test`,
    name: id,
    role: operator ? 'operator' : 'owner',
    creatorIds: typeof list === 'string' && list !== '' ? list.split(',') : [],
    routedCreatorIds: [],
    shiftCreatorIds: [],
  };
  request.membership = operator
    ? as === 'manager'
      ? { teamScope: 'agency', team: { role: 'manager', status: 'active' } }
      : { teamScope: 'self', team: { role: 'chatter', status: 'active' } }
    : null;
};

/** The fictional demo persona of the repository, stored as a creator's version (ADR 0010: never a real one). */
const DEMO = PersonaSchema.parse(
  parse(
    readFileSync(
      fileURLToPath(new URL('../../../../../../../personas/demo/v0.2.0.yaml', import.meta.url)),
      'utf8',
    ),
  ),
);
const MIA = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c1');
const DRAFT = PersonaVersionIdSchema.parse('0199f2a0-0000-7000-8000-0000000000e3');

async function server(
  options: {
    voice?: VoiceOutput;
    control?: GatewayControl;
    creatorId?: string | null;
    herScripts?: HerScriptsSource;
    voiceExamplesOf?: (creatorId: string) => Promise<readonly VoiceExample[]>;
    bank?: VoiceBankStore;
  } = {},
) {
  const records: CalibrationRecord[] = [];
  const stored: CalibrationRecord[] = [];
  const store: CalibrationStore = {
    append: (record) => {
      stored.push(record);
      return Promise.resolve();
    },
    list: () => Promise.resolve([]),
  };
  const playground = createPlaygroundModule({
    credentials: {},
    log: { append: () => undefined, since: () => [] },
    persona: {
      creatorName: 'Lina',
      personaSheet: 'fiche',
      forbiddenTerms: [],
      offerLimits: { cooldownHours: 10, minDesire: 70 },
      sexualizationLimits: { initiateAfterHours: 36, minHoursBeforeFollowing: 2, minDesireToOpen: 40 },
      followUps: { delaysHours: [12, 24], spirit: null },
      splitMessages: true,
      playsJealous: false,
      petNames: [],
      alertKeywords: [],
      forbiddenEmojis: [],
      kycSlots: [],
      objectionReplies: {},
      spokenLanguages: FRENCH_ONLY,
      languageExamples: {},
    },
    // « Tester » reads her active persona; none here: the words are read, the phrase needs no persona to be refused.
    activePersona: () => Promise.resolve(null),
    // Her version 0.0.3, not active yet: the one she is talked to before it is activated (PRO-21).
    personaVersion: (creatorId, versionId) =>
      Promise.resolve(
        creatorId === MIA && versionId === DRAFT
          ? { id: DRAFT, version: '0.0.3', creatorName: 'Mia', persona: DEMO }
          : null,
      ),
    store,
    records,
    gateway: gateway(options.voice ?? { bubbles: ['Coucou toi ✨'] }, options.control),
    gatewayForVoice: (model) => (model === 'mistral-large-4' ? gateway({ bubbles: ['Hey toi'] }) : undefined),
    now: () => new Date('2026-10-17T10:00:00Z'),
    ...(options.creatorId !== undefined && { creatorId: () => Promise.resolve(options.creatorId ?? null) }),
    ...(options.herScripts !== undefined && { herScripts: options.herScripts }),
    ...(options.voiceExamplesOf !== undefined && { voiceExamplesOf: options.voiceExamplesOf }),
    ...(options.bank !== undefined && { bank: options.bank }),
  });
  const config = testConfig();
  const app = await buildServer({
    config,
    logger: createLogger(config),
    routes: [playground.routes({ guard: ownerOnly })],
    readiness: () =>
      Promise.resolve({ isReady: true, checks: { database: true, migrations: true, worker: true } }),
  });
  const headers = { 'x-test-user': 'charles', origin: config.WEB_ORIGIN };
  const post = (url: string, payload: object = {}, as = headers) =>
    app.inject({ method: 'POST', url: `/v1/playground${url}`, headers: as, payload });
  return { app, headers, post, stored };
}

describe('/v1/playground', () => {
  it('keeps a correction a hard guard stops as a correction, out of her bank, and says which guard (ADR 0102 § 4)', async () => {
    const { post, stored } = await server();
    await post('/persona', { kind: 'version', creatorId: MIA, versionId: DRAFT });
    await post('/messages', { text: 'Salut' });
    const rated = await post('/rating', {
      verdict: { kind: 'corrected', text: 'Je suis une IA' },
      destination: 'voice_example',
    });
    const result = PlaygroundRatingResultSchema.parse(rated.json());
    expect(result.exampleBlockedBy?.map((v) => v.severity)).toContain('blocking');
    expect(result.exampleBlockedBy?.[0]?.label).not.toBe('');
    expect(stored.at(-1)).toMatchObject({ destination: 'voice_example', exampleBlocked: true });

    await post('/messages', { text: 'Et toi ?' });
    const fine = PlaygroundRatingResultSchema.parse(
      (await post('/rating', { verdict: { kind: 'corrected', text: 'Coucou toi ✨' } })).json(),
    );
    expect(fine.exampleBlockedBy).toBeUndefined();
    expect(stored.at(-1)?.exampleBlocked).toBeUndefined();
  });

  it('gives her version the examples of her bank, chosen as her drafts choose them (ADR 0102 § 2)', async () => {
    const control: GatewayControl = { hasKey: true, sheets: [] };
    const asked: string[] = [];
    const { post } = await server({
      control,
      voiceExamplesOf: (creatorId) => {
        asked.push(creatorId);
        return Promise.resolve([
          { id: 'e2', text: 'Hey toi, exemple de sa banque' },
          { id: 'e1', text: 'Je suis une IA' },
        ]);
      },
    });
    await post('/persona', { kind: 'version', creatorId: MIA, versionId: DRAFT });
    await post('/messages', { text: 'Salut' });
    // Her one bank, whichever version is played (ADR 0102 § 1).
    expect(asked).toEqual([MIA]);
    expect(control.sheets?.at(-1)).toContain('Hey toi, exemple de sa banque');
    expect(control.sheets?.at(-1)).not.toContain('Je suis une IA');
  });

  it('is closed to anyone without the owner session', async () => {
    const { app } = await server();
    expect((await app.inject({ method: 'GET', url: '/v1/playground' })).statusCode).toBe(403);
  });

  it('shows the presets, the reasons in French and nothing to rate at first', async () => {
    const { app, headers } = await server();
    const state = stateOf(await app.inject({ method: 'GET', url: '/v1/playground', headers }));
    expect(state.presets).toHaveLength(9);
    expect(state.rejectReasons).toContainEqual({ id: 'too_long', label: 'trop long' });
    expect(state).toMatchObject({ pending: null, rate: { rate: null, target: 0.8 }, presetId: null });
    expect(state).toMatchObject({ sessionCostEur: 0, voice: { reachable: true } });
    // The persona it plays, by her first name: never taken for one of the agency's creators.
    expect(state.persona).toEqual({ name: 'Lina', played: null });
    expect(state.situation).toMatchObject({ timeZone: 'Europe/Paris', isNight: false });
  });

  it('plays a version of hers, active or not, files its ratings under her, and goes back to the invented one (PRO-21)', async () => {
    const { app, headers, post, stored } = await server({ creatorId: null });
    await post('/messages', { text: 'Salut' });
    const chosen = await post('/persona', { kind: 'version', creatorId: MIA, versionId: DRAFT });
    expect(chosen.statusCode, chosen.body).toBe(200);
    const state = stateOf(chosen);
    expect(state.persona).toEqual({
      name: 'Elena',
      played: { creatorId: MIA, versionId: DRAFT, version: '0.0.3' },
    });
    // The conversation starts over with her.
    expect(state.history).toEqual([]);
    expect(state.pending).toBeNull();
    await post('/messages', { text: 'Salut' });
    expect((await post('/rating', { verdict: { kind: 'validated' } })).statusCode).toBe(200);
    expect(stored[0]?.creatorId).toBe(MIA);

    const unknown = await post('/persona', {
      kind: 'version',
      creatorId: MIA,
      versionId: PersonaVersionIdSchema.parse('0199f2a0-0000-7000-8000-0000000000e9'),
    });
    expect(unknown.statusCode).toBe(404);
    expect(codeOf(unknown)).toBe('playground_persona_not_found');
    // Refused, her playground stays as it was.
    expect(
      stateOf(await app.inject({ method: 'GET', url: '/v1/playground', headers })).persona.played,
    ).toEqual({
      creatorId: MIA,
      versionId: DRAFT,
      version: '0.0.3',
    });

    const back = stateOf(await post('/persona', { kind: 'invented' }));
    expect(back.persona).toEqual({ name: 'Lina', played: null });
  });

  it('reads her own scripts with one of her versions, and says at once why the trial ones play instead (ADR 0103 § 15)', async () => {
    const asked: [string, string][] = [];
    const { post } = await server({
      herScripts: (creatorId, trainer) => {
        asked.push([creatorId, trainer.userId]);
        return Promise.resolve({ kind: 'none', reason: 'none_ready' });
      },
    });
    const hers = stateOf(await post('/persona', { kind: 'version', creatorId: MIA, versionId: DRAFT }));
    expect(asked).toHaveLength(1);
    expect(asked[0]?.[0]).toBe(MIA);
    expect(hers.scripts).toMatchObject({ source: 'trial', unavailable: { code: 'none_ready' }, run: null });
    expect(hers.scripts.unavailable?.label).toBe('Aucun de ses scripts n’est prêt');
    // The invented persona plays the trial scripts, and never reads hers.
    const back = stateOf(await post('/persona', { kind: 'invented' }));
    expect(back.scripts).toMatchObject({ source: 'trial', unavailable: null });
    expect(asked).toHaveLength(1);
  });

  it('answers, rates once, and counts the rate', async () => {
    const { app, headers, post, stored } = await server();
    const answer = await post('/messages', { text: 'Salut' });
    expect(answer.json()).toMatchObject({ bubbles: ['Coucou toi ✨'], isBlocked: false, model: 'grok-4.7' });
    // Her typing time, as the real send counts it: 1,5 s + 150 ms for each of the 12 characters (the emoji is one).
    expect(answer.json()).toMatchObject({ delaysMs: [3300] });
    // Costs are journaled in USD and shown in euros, at the daily budget's rate (ADR 0011).
    const usdPerEur = DEFAULT_LLM_CONFIG.dailyBudget.usdPerEur;
    const { costEur } = PlaygroundAnswerSchema.parse(answer.json());
    expect(costEur).toBeCloseTo(0.002 / usdPerEur);
    const after = stateOf(await app.inject({ method: 'GET', url: '/v1/playground', headers }));
    expect(after.sessionCostEur).toBeCloseTo(costEur);

    const rating = await post('/rating', { verdict: { kind: 'validated' } });
    expect(rating.json()).toMatchObject({ rate: { rate: 1, rated: 1 }, destination: null });
    expect(stored).toHaveLength(1);

    const again = await post('/rating', { verdict: { kind: 'validated' } });
    expect(again.statusCode).toBe(409);
    expect(codeOf(again)).toBe('nothing_to_rate_conflict');
    expect(stored[0]?.creatorId).toBeUndefined();
  });

  it('shows his desire score under his message, each signal with its points, and her two thresholds (P3-12)', async () => {
    const { app, headers, post } = await server();
    const first = PlaygroundAnswerSchema.parse((await post('/messages', { text: 'Salut' })).json());
    expect(first.desire).toMatchObject({ before: null, score: 0, band: 'neutral', signals: [] });
    // Beside it, his availability and the gate, each missing condition in French (ADR 0103 § 14).
    expect(first.desire?.availability).toMatchObject({
      state: 'unknown',
      signal: null,
      seen: [],
      sexualized: false,
    });
    expect(first.desire?.availability?.gate).toEqual({
      open: false,
      missing: [
        { code: 'desire_below_threshold', label: 'Désir sous le seuil du script' },
        { code: 'not_sexualizing', label: 'Il ne sexualise pas encore lui-même' },
        { code: 'availability_unconfirmed', label: 'Il n’a pas dit être seul et libre' },
      ],
    });
    // What she still has to learn, in her words, never a slot's code.
    expect(first.brief?.kycMissing).toEqual(['prénom']);
    await post('/rating', { verdict: { kind: 'validated' } });
    const answer = PlaygroundAnswerSchema.parse(
      (await post('/messages', { text: 'Ça va ? Je sors à peine du travail, longue journée' })).json(),
    );
    // A message much longer than his first: the long reply counts, with its points from the code.
    expect(answer.desire?.signals).toContainEqual({ signal: 'long_reply', points: 5 });
    const state = stateOf(await app.inject({ method: 'GET', url: '/v1/playground', headers }));
    expect(state.history.filter((turn) => turn.from === 'fan').map((turn) => turn.desire)).toEqual([
      first.desire,
      answer.desire,
    ]);
    expect(state.history.find((turn) => turn.from === 'creator')?.desire).toBeUndefined();
    expect(state.desireThresholds.script).toBeGreaterThan(state.desireThresholds.open);
  });

  it('keeps the owner’s mark on his desire score for a version of hers, and reads it back with the weights now (ADR 0103 § 6)', async () => {
    const { app, headers, post } = await server();
    await post('/messages', { text: 'Salut' });
    const invented = await post('/desire-marks', { fanMessageNumber: 1, verdict: 'too_high' });
    expect(invented.statusCode).toBe(409);
    expect(codeOf(invented)).toBe('desire_mark_invented_persona_conflict');

    await post('/persona', { kind: 'version', creatorId: MIA, versionId: DRAFT });
    await post('/messages', { text: 'Salut' });
    expect((await post('/desire-marks', { fanMessageNumber: 2, verdict: 'right' })).statusCode).toBe(404);
    const marked = await post('/desire-marks', {
      fanMessageNumber: 1,
      verdict: 'too_high',
      note: 'Il dit juste bonjour',
    });
    expect(marked.statusCode, marked.body).toBe(200);
    expect(stateOf(marked).history.find((turn) => turn.from === 'fan')?.desire?.mark).toBe('too_high');

    const read = await app.inject({
      method: 'GET',
      url: `/v1/playground/desire-marks?creatorId=${MIA}`,
      headers,
    });
    const { marks, weightsNow } = DesireMarksSchema.parse(read.json());
    expect(weightsNow).toMatch(/^desire-/);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      fanMessage: 'Salut',
      verdict: 'too_high',
      note: 'Il dit juste bonjour',
      scoreThen: 0,
      scoreNow: 0,
    });
    // Starting over forgets the marks shown, never the ones kept.
    expect(stateOf(await post('/reset')).history).toEqual([]);
    const again = await app.inject({
      method: 'GET',
      url: `/v1/playground/desire-marks?creatorId=${MIA}`,
      headers,
    });
    expect(DesireMarksSchema.parse(again.json()).marks).toHaveLength(1);
  });

  it('files the rating under the creator when there is one, and leaves it unassigned otherwise', async () => {
    const one = await server({ creatorId: 'creator-1' });
    await one.post('/messages', { text: 'Salut' });
    await one.post('/rating', { verdict: { kind: 'validated' } });
    expect(one.stored[0]?.creatorId).toBe('creator-1');

    const none = await server({ creatorId: null });
    await none.post('/messages', { text: 'Salut' });
    await none.post('/rating', { verdict: { kind: 'validated' } });
    expect(none.stored[0]).not.toHaveProperty('creatorId');
  });

  it('refuses to validate a blocked answer, and keeps a correction as a voice example', async () => {
    const { post, stored } = await server({ voice: { bubbles: ['Je suis une IA'] } });
    const answer = PlaygroundAnswerSchema.parse((await post('/messages', { text: 'T’es un bot ?' })).json());
    expect(answer.isBlocked).toBe(true);
    expect(answer.violations[0]).toMatchObject({
      code: 'ai_disclosure',
      label: 'Elle dit ou laisse entendre qu’elle est une IA',
    });

    const validated = await post('/rating', { verdict: { kind: 'validated' } });
    expect(codeOf(validated)).toBe('blocked_answer_conflict');

    const corrected = await post('/rating', { verdict: { kind: 'corrected', text: 'Un bot ? Moi ? 😉' } });
    expect(PlaygroundRatingResultSchema.parse(corrected.json()).destination).toBe('voice_example');
    expect(stored[0]?.verdict).toEqual({ kind: 'corrected', text: 'Un bot ? Moi ? 😉' });
  });

  it('hands a flagged media to a human and writes nothing', async () => {
    const { post } = await server();
    const answer = await post('/messages', {
      text: 'Regarde',
      media: [{ kind: 'image', factualDescription: 'Un selfie.', flags: ['possible_minor'] }],
    });
    expect(answer.json()).toMatchObject({ handoff: ['possible_minor'], isBlocked: true, bubbles: [] });
    expect(answer.json()).not.toHaveProperty('delaysMs');
    // « Nécessaire » says the handoff was right: a decision to rate, not a blocked answer (AGE-01).
    expect((await post('/rating', { verdict: { kind: 'validated' } })).statusCode).toBe(200);
  });

  it('asks for the Grok key when no voice model is reachable', async () => {
    const { app, headers, post } = await server({ control: { hasKey: false } });
    const state = stateOf(await app.inject({ method: 'GET', url: '/v1/playground', headers }));
    expect(state.voice).toEqual({ reachable: false });
    const response = await post('/messages', { text: 'Salut' });
    expect(response.statusCode).toBe(503);
    expect(codeOf(response)).toBe('llm_unavailable');
  });

  it('keeps each user’s conversation apart', async () => {
    const { app, post, headers } = await server();
    await post('/messages', { text: 'Salut' });
    const other = { ...headers, 'x-test-user': 'messa' };
    const mine = stateOf(await app.inject({ method: 'GET', url: '/v1/playground', headers }));
    const hers = stateOf(await app.inject({ method: 'GET', url: '/v1/playground', headers: other }));
    expect(mine.history).toHaveLength(2);
    expect(hers.history).toHaveLength(0);
  });

  it('applies a preset, moves her clock and rejects what it does not know', async () => {
    const { app, post, headers } = await server();
    const preset = stateOf(await post('/preset', { presetId: 'acheteur' }));
    expect(preset.presetId).toBe('acheteur');
    expect(preset.situation.spentCents).toBeGreaterThan(0);
    expect((await post('/preset', { presetId: 'inconnu' })).statusCode).toBe(404);

    const night = await app.inject({
      method: 'PATCH',
      url: '/v1/playground/situation',
      headers,
      payload: { localTime: '23:30' },
    });
    expect(stateOf(night).situation).toMatchObject({ now: '2026-10-17T21:30:00.000Z', isNight: true });

    const zone = await app.inject({
      method: 'PATCH',
      url: '/v1/playground/situation',
      headers,
      payload: { timeZone: 'Mars/Olympus' },
    });
    expect(codeOf(zone)).toBe('time_zone_invalid');
  });

  it('compares with another voice model without touching the conversation', async () => {
    const { post } = await server();
    await post('/messages', { text: 'Salut' });
    const comparison = await post('/compare', { voiceModel: 'mistral-large-4' });
    expect(comparison.json()).toMatchObject({ bubbles: ['Hey toi'], isBlocked: false });
    expect(codeOf(await post('/compare', { voiceModel: 'gpt-x' }))).toBe('voice_model_invalid');
  });

  it('refuses an empty message and a destination on a validated answer', async () => {
    const { post } = await server();
    expect((await post('/messages', { text: '  ' })).statusCode).toBe(400);
    await post('/messages', { text: 'Salut' });
    const rating = await post('/rating', { verdict: { kind: 'validated' }, destination: 'rule' });
    expect(rating.statusCode).toBe(400);
  });

  it('keeps the conversation whole when a replay cannot be answered', async () => {
    const control: GatewayControl = { hasKey: true };
    const { app, post, headers } = await server({ control });
    await post('/messages', { text: 'Salut' });
    await post('/rating', { verdict: { kind: 'validated' } });
    await post('/messages', { text: 'Ça va ?' });
    control.hasKey = false;
    expect((await post('/branch', { fanMessageNumber: 1 })).statusCode).toBe(503);
    const state = stateOf(await app.inject({ method: 'GET', url: '/v1/playground', headers }));
    expect(state.history).toHaveLength(4);
    expect(state.pending).not.toBeNull();
  });

  it('answers one message at a time', async () => {
    let release = (): void => undefined;
    const control: GatewayControl = { hasKey: true, hold: new Promise((resolve) => (release = resolve)) };
    const { post } = await server({ control });
    // inject() starts on its first then(): Promise.resolve sends it now, the tick lets it reach the voice.
    const first = Promise.resolve(post('/messages', { text: 'Salut' }));
    await new Promise((resolve) => setImmediate(resolve));
    const second = await post('/messages', { text: 'T’es là ?' });
    expect(codeOf(second)).toBe('answer_in_progress_conflict');
    release();
    expect((await first).statusCode).toBe(200);
  });

  it('shows the brain’s reading while the voice writes, and nothing once she has answered', async () => {
    let release = (): void => undefined;
    const control: GatewayControl = { hasKey: true, hold: new Promise((resolve) => (release = resolve)) };
    const { app, headers, post } = await server({ control });
    const first = Promise.resolve(post('/messages', { text: 'Salut' }));
    // A few ticks for the brain to read him and the voice to start.
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
    const writing = stateOf(await app.inject({ method: 'GET', url: '/v1/playground', headers }));
    expect(writing.reading).toMatchObject({ intent: BRIEF.intent, action: BRIEF.action });
    expect(writing.pending).toBeNull();
    release();
    expect((await first).statusCode).toBe(200);
    const answered = stateOf(await app.inject({ method: 'GET', url: '/v1/playground', headers }));
    expect(answered.reading).toBeUndefined();
  });

  it('answers « Payer (fictif) » and « Refuser » only while a paid step of a trial script waits (ADR 0103 § 16)', async () => {
    const { app, headers, post } = await server();
    const state = stateOf(await app.inject({ method: 'GET', url: '/v1/playground', headers }));
    expect(state.scripts).toEqual({
      source: 'trial',
      unavailable: null,
      run: null,
      fictiveSpentCents: 0,
      salesFrozen: false,
    });
    const buy = await post('/script/buy');
    expect(buy.statusCode).toBe(409);
    expect(codeOf(buy)).toBe('script_step_not_waiting_conflict');
    expect(codeOf(await post('/script/refuse'))).toBe('script_step_not_waiting_conflict');
  });

  it('has nothing to compare after a handoff', async () => {
    const { post } = await server();
    await post('/messages', {
      text: 'Regarde',
      media: [{ kind: 'image', factualDescription: 'Un selfie.', flags: ['possible_minor'] }],
    });
    const comparison = await post('/compare', { voiceModel: 'mistral-large-4' });
    expect(codeOf(comparison)).toBe('nothing_to_compare_conflict');
  });
});

describe('POST /v1/alerts/test (P4-01)', () => {
  const alert = { phrase: 'Il demande une vidéo rien que pour lui', keywords: ['vidéo perso'] };
  const creatorId = '7f0c8a52-3a35-4c5e-9a1e-2d8f6f0e1a01';

  it('is closed to anyone without the owner session', async () => {
    const { app } = await server();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/alerts/test',
      payload: { creatorId, alert, message: 'une vidéo perso ?' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('reads her words in code, and says why the phrase was not read when no brain is reachable', async () => {
    const { app, headers } = await server();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/alerts/test',
      headers,
      payload: { creatorId, alert, message: 'Tu me fais une Video-Perso ?' },
    });
    expect(response.statusCode).toBe(200);
    const result = AlertTestResultSchema.parse(response.json());
    expect(result).toMatchObject({ keywords: ['vidéo perso'], phraseMatched: null });
    expect(result.reason).toContain('Modèles IA');
  });

  it('refuses an alert with neither phrase nor word', async () => {
    const { app, headers } = await server();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/alerts/test',
      headers,
      payload: { creatorId, alert: { phrase: null, keywords: [] }, message: 'coucou' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a test that names no creator: the phrase is read with her persona (recette M13)', async () => {
    const { app, headers } = await server();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/alerts/test',
      headers,
      payload: { alert, message: 'coucou' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('/v1/playground for a manager (ADR 0092 § 8, trou 11)', () => {
  const OTHER = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c2');
  const emptyBank: VoiceBankStore = {
    list: () => Promise.resolve([]),
    withdraw: () => Promise.resolve(true),
  };

  async function asManager(list: readonly string[] = [MIA]) {
    const built = await server({ bank: emptyBank });
    const manager = {
      ...built.headers,
      'x-test-user': 'pierre',
      'x-test-as': 'manager',
      'x-test-creators': list.join(','),
    };
    return { ...built, manager };
  }

  it('plays the creators of his list alone', async () => {
    const { post, manager } = await asManager();
    const hers = await post('/persona', { kind: 'version', creatorId: MIA, versionId: DRAFT }, manager);
    expect(hers.statusCode).toBe(200);
    expect(stateOf(hers).persona.played).toMatchObject({ creatorId: MIA });
    const other = await post('/persona', { kind: 'version', creatorId: OTHER, versionId: DRAFT }, manager);
    expect(other.statusCode).toBe(403);
    expect(codeOf(other)).toBe('creator_forbidden');
  });

  it('finds the invented persona again once she is taken off his list', async () => {
    const { app, post, manager } = await asManager();
    await post('/persona', { kind: 'version', creatorId: MIA, versionId: DRAFT }, manager);
    const after = { ...manager, 'x-test-creators': OTHER };
    const state = stateOf(await app.inject({ method: 'GET', url: '/v1/playground', headers: after }));
    expect(state.persona).toEqual({ name: 'Lina', played: null });
  });

  it('notes and corrects, but files nothing in her bank: that stays the owner’s', async () => {
    const { post, stored, manager } = await asManager();
    await post('/persona', { kind: 'version', creatorId: MIA, versionId: DRAFT }, manager);
    await post('/messages', { text: 'Salut' }, manager);
    const filed = await post(
      '/rating',
      { verdict: { kind: 'corrected', text: 'Coucou toi ✨' }, destination: 'voice_example' },
      manager,
    );
    expect(filed.statusCode).toBe(403);
    expect(codeOf(filed)).toBe('voice_bank_owner_forbidden');

    const corrected = await post(
      '/rating',
      { verdict: { kind: 'corrected', text: 'Coucou toi ✨' } },
      manager,
    );
    expect(corrected.statusCode).toBe(200);
    expect(PlaygroundRatingResultSchema.parse(corrected.json()).destination).not.toBe('voice_example');
    expect(stored.at(-1)).toMatchObject({ verdict: { kind: 'corrected', text: 'Coucou toi ✨' } });
    expect(stored.at(-1)?.destination).not.toBe('voice_example');
  });

  it('reads her bank, withdraws nothing, and tests no alert', async () => {
    const { app, post, manager } = await asManager();
    const bank = (creatorId: string) =>
      app.inject({
        method: 'GET',
        url: `/v1/playground/bank?creatorId=${creatorId}&versionId=${DRAFT}`,
        headers: manager,
      });
    expect((await bank(MIA)).statusCode).toBe(200);
    expect(codeOf(await bank(OTHER))).toBe('creator_forbidden');
    const withdraw = await post(
      '/bank/withdraw',
      { creatorId: MIA, versionId: DRAFT, id: '0199f2a0-0000-7000-8000-0000000000f1' },
      manager,
    );
    expect(codeOf(withdraw)).toBe('voice_bank_owner_forbidden');
    const alert = await app.inject({
      method: 'POST',
      url: '/v1/alerts/test',
      headers: manager,
      payload: {
        creatorId: MIA,
        alert: { phrase: 'Il demande une vidéo', keywords: ['vidéo'] },
        message: 'Salut',
      },
    });
    expect(codeOf(alert)).toBe('role_forbidden');
  });

  it('stays closed to a chatter', async () => {
    const { app, headers } = await server();
    const chatter = { ...headers, 'x-test-user': 'lea', 'x-test-as': 'chatter', 'x-test-creators': MIA };
    const response = await app.inject({ method: 'GET', url: '/v1/playground', headers: chatter });
    expect(response.statusCode).toBe(403);
    expect(codeOf(response)).toBe('role_forbidden');
  });
});
