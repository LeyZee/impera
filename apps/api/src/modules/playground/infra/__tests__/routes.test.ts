import {
  AlertTestResultSchema,
  ApiErrorSchema,
  PlaygroundAnswerSchema,
  PlaygroundRatingResultSchema,
  PlaygroundStateSchema,
} from '@nirvana/contracts';
import {
  DEFAULT_LLM_CONFIG,
  type Brief,
  type HealthReport,
  type LlmGateway,
  type VoiceOutput,
} from '@nirvana/llm';
import type { LightMyRequestResponse, preValidationAsyncHookHandler } from 'fastify';
import { describe, expect, it } from 'vitest';

import { testConfig } from '../../../../__tests__/support/config';
import { createLogger } from '../../../../logger';
import { buildServer } from '../../../../server';
import type { CalibrationRecord, CalibrationStore } from '../../../agent/index';
import { createPlaygroundModule } from '../../index';

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
  };
}

/** `keys.voice` can be switched off mid-test; `hold` delays the voice until the test releases it. */
interface GatewayControl {
  hasKey: boolean;
  hold?: Promise<void>;
}

function gateway(voice: VoiceOutput, control: GatewayControl = { hasKey: true }): LlmGateway {
  return {
    sense: () => Promise.reject(new Error('not used')),
    transcribe: () => Promise.reject(new Error('not used')),
    brain: () => Promise.resolve({ ok: true, value: { output: BRIEF, meta: META } }),
    voice: async () => {
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
  request.user = {
    id,
    email: `${id}@example.test`,
    name: id,
    role: 'owner',
    creatorIds: [],
    routedCreatorIds: [],
  };
};

async function server(
  options: { voice?: VoiceOutput; control?: GatewayControl; creatorId?: string | null } = {},
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
      petNames: [],
      alertKeywords: [],
      forbiddenEmojis: [],
      kycSlots: [],
    },
    // « Tester » reads her active persona; none here: the words are read, the phrase needs no persona to be refused.
    activePersona: () => Promise.resolve(null),
    store,
    records,
    gateway: gateway(options.voice ?? { bubbles: ['Coucou toi ✨'] }, options.control),
    gatewayForVoice: (model) =>
      model === 'mistral-large-latest' ? gateway({ bubbles: ['Hey toi'] }) : undefined,
    now: () => new Date('2026-10-17T10:00:00Z'),
    ...(options.creatorId !== undefined && { creatorId: () => Promise.resolve(options.creatorId ?? null) }),
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
    expect(state.persona).toEqual({ name: 'Lina' });
    expect(state.situation).toMatchObject({ timeZone: 'Europe/Paris', isNight: false });
  });

  it('answers, rates once, and counts the rate', async () => {
    const { app, headers, post, stored } = await server();
    const answer = await post('/messages', { text: 'Salut' });
    expect(answer.json()).toMatchObject({ bubbles: ['Coucou toi ✨'], isBlocked: false, model: 'grok-4.7' });
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
    const comparison = await post('/compare', { voiceModel: 'mistral-large-latest' });
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

  it('has nothing to compare after a handoff', async () => {
    const { post } = await server();
    await post('/messages', {
      text: 'Regarde',
      media: [{ kind: 'image', factualDescription: 'Un selfie.', flags: ['possible_minor'] }],
    });
    const comparison = await post('/compare', { voiceModel: 'mistral-large-latest' });
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
