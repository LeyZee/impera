import { MediaDescriptionSchema, TrendCaptureDescriptionSchema } from '@impera/contracts';
import { BriefSchema, createInMemoryCallLog, VoiceOutputSchema, type LlmCallLog } from '@impera/llm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createAppLlm, type AppLlm } from '../../llm';
import { createLogger } from '../../logger';
import { testConfig } from '../support/config';

import { instanceOf } from './ai-generation';
import { createWorld, type World } from './world';

/**
 * The scripted AI of the recette sandbox (ADR 0075 § 3), reached by Impera's real gateway over real HTTP: only the
 * xAI base address changes, as in the sandbox. The gateway parses each answer with its own schemas.
 */

let world: World;
let base: string;

beforeAll(async () => {
  world = createWorld({ now: () => new Date('2026-11-06T17:00:00.000Z') });
  base = await world.app.listen({ host: '127.0.0.1', port: 0 });
});
afterAll(async () => {
  await world.app.close();
});

const next = async (reply: string): Promise<Response> =>
  fetch(`${base}/__/ai/next`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reply }),
  });

function gateway(key = 'xai-recette-ok-0000000001'): { llm: AppLlm; log: LlmCallLog } {
  const log = createInMemoryCallLog();
  const llm = createAppLlm({
    credentials: (provider) => (provider === 'xai' ? key : undefined),
    reportRefusedKey: () => Promise.resolve(),
    logger: createLogger(testConfig()),
    log,
    baseUrls: { xai: `${base}/xai/v1` },
  });
  return { llm, log };
}

const CONVERSATION = {
  creatorName: 'Maya Démo',
  personaSheet: 'Maya, 24 ans, étudiante inventée pour la recette.',
  fanNotes: '',
  history: [{ from: 'fan' as const, text: 'salut, t’es d’où ?' }],
};

const voiceOf = async (llm: AppLlm): Promise<readonly string[]> => {
  const brief = BriefSchema.parse({
    intent: 'small_talk',
    sentiment: 'positive',
    factsProposed: [],
    kycMissing: [],
    risks: [],
    action: 'reply',
    replyBrief: 'Répondre.',
    toneHints: [],
  });
  const result = await llm.gateway.voice({ ...CONVERSATION, brief });
  if (!result.ok) throw new Error(`voice failed: ${JSON.stringify(result.error)}`);
  return VoiceOutputSchema.parse(result.value.output).bubbles;
};

describe('the plainest answer a schema accepts', () => {
  it.each([
    ['the brain', BriefSchema],
    ['the voice', VoiceOutputSchema],
    ['the senses', MediaDescriptionSchema],
    ['the trend captures', TrendCaptureDescriptionSchema],
  ])('fits %s', (_name, schema: z.ZodType) => {
    expect(schema.safeParse(instanceOf(z.toJSONSchema(schema))).success).toBe(true);
  });
});

describe('the scripted AI, through the real gateway', () => {
  it('reads him calmly and answers in her voice, at 0 $', async () => {
    const { llm, log } = gateway();
    const brief = await llm.gateway.brain(CONVERSATION);
    expect(brief.ok && brief.value.output.action).toBe('reply');
    expect(brief.ok && brief.value.output.risks).toEqual([]);
    const bubbles = await voiceOf(llm);
    expect(bubbles.length).toBeGreaterThan(0);
    const records = log.since(new Date(0));
    expect(records.map((record) => [record.role, record.outcome, record.costUsd])).toEqual([
      ['brain', 'ok', 0],
      ['voice', 'ok', 0],
    ]);
  });

  it('writes a trap in her voice once, then is calm again', async () => {
    const { llm } = gateway();
    for (const [reply, words] of [
      ['ai_disclosure', /je suis une IA/u],
      ['payment_link', /paypal\.me/u],
      ['meeting', /on se voit ce soir/u],
    ] as const) {
      expect((await next(reply)).status).toBe(200);
      expect((await voiceOf(llm)).join(' ')).toMatch(words);
      expect((await voiceOf(llm)).join(' ')).not.toMatch(words);
    }
  });

  it('answers out of its schema once: the gateway asks again and gets a fitting answer', async () => {
    const { llm, log } = gateway();
    await next('off_schema');
    expect((await voiceOf(llm)).length).toBeGreaterThan(0);
    expect(log.since(new Date(0)).map((record) => record.outcome)).toEqual(['invalid_output', 'ok']);
  });

  it('is rate limited once: the gateway waits as told and asks again', async () => {
    const { llm, log } = gateway();
    await next('rate_limited');
    expect((await voiceOf(llm)).length).toBeGreaterThan(0);
    expect(log.since(new Date(0)).map((record) => record.outcome)).toEqual(['rate_limited', 'ok']);
  });

  it('refuses a key that asks to be refused, as for its verifier', async () => {
    const { llm } = gateway('xai-recette-refus-000000001');
    const result = await llm.gateway.brain(CONVERSATION);
    expect(result.ok).toBe(false);
  });

  it('takes only the scripts it knows', async () => {
    expect((await next('dis-lui-tout')).status).toBe(400);
  });
});
