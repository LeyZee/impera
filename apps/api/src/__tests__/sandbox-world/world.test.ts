import type { AiProvider } from '@impera/contracts';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { revealSalesFeed } from '../../modules/connectors';
import { createMemoryCredentialStore, createProvidersModule } from '../../modules/providers';
import { revealSignature } from '../fake-reveal/crm';

import { createWorld, outcomeOfKey, type World } from './world';

/**
 * The recette sandbox's fake world (ADR 0075), over real HTTP on this machine, read by Impera's real key verifiers
 * and Reveal's real CRM adapter: only their base address changes, as in the sandbox.
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

const control = async (path: string, body: object): Promise<Response> =>
  fetch(`${base}/__${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

function providers() {
  return createProvidersModule({
    store: createMemoryCredentialStore(),
    fetch,
    environmentKeys: null,
    baseUrls: {
      xai: `${base}/xai`,
      google: `${base}/google`,
      mistral: `${base}/mistral`,
      elevenlabs: `${base}/elevenlabs`,
    },
  });
}

describe('a key decides its own fate', () => {
  it.each([
    ['xai-recette-ok-0000000001', 'ok'],
    ['xai-recette-REFUS-00000001', 'refused'],
    ['AIza-recette-credit-00000001', 'no_credit'],
    ['sk_recette_limite_00000001', 'rate_limited'],
    ['mistral-recette-panne-0001', 'down'],
  ])('%s → %s', (key, outcome) => {
    expect(outcomeOfKey(key)).toBe(outcome);
  });
});

describe('the AI keys, pasted as on the day they arrive', () => {
  const cases: readonly (readonly [AiProvider, string, string])[] = [
    ['xai', 'xai-recette-ok-0000000001', 'Grok 4.7 écrit et décide'],
    ['google', 'AIza-recette-ok-0000000001', 'Gemini 3.8 Flash regarde les médias'],
    ['mistral', 'mistral-recette-ok-000001', 'Mistral Large prend le relais si Grok ne répond plus'],
  ];

  it.each(cases)('%s: an ordinary key is accepted by the real verifier', async (provider, key, summary) => {
    const result = await providers().connect(provider, key);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain(summary);
    // The key is never part of what the module answers.
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it('ElevenLabs: accepted with the voice named after Messa picked', async () => {
    const result = await providers().connect('elevenlabs', 'sk_recette_ok_000000000001');
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).toContain('voice_recette_messa');
  });

  it.each([
    ['xai', 'xai-recette-refus-000000001', 'unauthorized'],
    ['xai', 'xai-recette-credit-00000001', 'no_credit'],
    ['google', 'AIza-recette-refus-00000001', 'unauthorized'],
    ['google', 'AIza-recette-credit-00000001', 'api_not_enabled'],
    ['mistral', 'mistral-recette-credit-0001', 'no_credit'],
    ['elevenlabs', 'sk_recette_refus_0000000001', 'unauthorized'],
    ['xai', 'xai-recette-limite-00000001', 'unreachable'],
    ['google', 'AIza-recette-panne-00000001', 'unreachable'],
  ] as const)('%s: %s is refused as %s, and nothing is saved', async (provider, key, kind) => {
    const module = providers();
    const result = await module.connect(provider, key);
    expect(result).toMatchObject({ ok: false, error: { kind } });
    expect((await module.list()).find((status) => status.provider === provider)?.state).not.toBe('connected');
  });

  it('a whole service down at the control route turns a good key away as unreachable, then back', async () => {
    await control('/services/xai', { mode: 'down' });
    const module = providers();
    expect(await module.connect('xai', 'xai-recette-ok-0000000001')).toMatchObject({
      ok: false,
      error: { kind: 'unreachable' },
    });
    await control('/services/xai', { mode: 'auto' });
    expect((await module.connect('xai', 'xai-recette-ok-0000000001')).ok).toBe(true);
  });

  it('generation is not simulated yet: an outage, never a made-up answer', async () => {
    const reply = await fetch(`${base}/xai/v1/chat/completions`, { method: 'POST' });
    expect(reply.status).toBe(503);
  });
});

describe('Reveal’s CRM API, read by the real adapter', () => {
  const feed = (key: string) => revealSalesFeed(fetch, `${base}/reveal-crm`).create(key);

  it('a key with Reveal’s prefix is verified, then the sales the world makes are read in order', async () => {
    const reveal = feed('rvl_recette_ok_0001');
    expect(await reveal.verify()).toMatchObject({ ok: true });

    const sold = await control('/reveal/sell', { euros: 25, chatterId: 'bot_test_01' });
    const sale = z.object({ id: z.string() }).parse(await sold.json());
    await control('/reveal/refund', { saleId: sale.id });

    const page = await reveal.readSales(null);
    expect(page.ok).toBe(true);
    expect(JSON.stringify(page)).toContain(sale.id);
    // The fan's handle never passes the adapter (ADR 0050 § 4).
    expect(JSON.stringify(page)).not.toContain('fan_recette_');
  });

  it('a key that asks to be refused is, and a revoked key stops every call until restored', async () => {
    expect(await feed('rvl_recette_refus_0001').verify()).toMatchObject({ ok: false });
    const reveal = feed('rvl_recette_ok_0002');
    await control('/reveal/key', { state: 'revoked' });
    expect(await reveal.readSales(null)).toMatchObject({ ok: false });
    await control('/reveal/key', { state: 'restored' });
    expect(await reveal.readSales(null)).toMatchObject({ ok: true });
  });

  it('the models for the import can be switched to every status Reveal names', async () => {
    await control('/reveal/models', { preset: 'import' });
    const models = await feed('rvl_recette_ok_0003').listModels();
    expect(JSON.stringify(models)).toContain('model_imp_banned');
    await control('/reveal/models', { preset: 'default' });
  });
});

describe('the control routes', () => {
  it('say in French what the world is and how keys behave', async () => {
    const state = z.object({ monde: z.string() }).parse(await (await fetch(`${base}/__`)).json());
    expect(state.monde).toContain('rien n’est réel');
  });

  it('refuse what they do not understand', async () => {
    expect((await control('/services/openai', { mode: 'down' })).status).toBe(400);
    expect((await control('/reveal/sell', { euros: -3 })).status).toBe(400);
    expect((await control('/reveal/refund', { saleId: 'inconnue' })).status).toBe(404);
  });
});

describe('Reveal’s webhooks, delivered for real on this machine', () => {
  it('posts each sale signed to the webhook, and tries again 30 s later when the receiver failed', async () => {
    const received: { signature: string; event: string; body: string }[] = [];
    let failures = 1;
    const receiver = Fastify();
    receiver.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
      done(null, body);
    });
    receiver.post('/v1/webhooks/sales-feeds/reveal', (request, reply) => {
      const signature = request.headers['x-reveal-signature'];
      const event = request.headers['x-reveal-event'];
      received.push({
        signature: typeof signature === 'string' ? signature : '',
        event: typeof event === 'string' ? event : '',
        body: typeof request.body === 'string' ? request.body : '',
      });
      if (failures > 0) {
        failures -= 1;
        return reply.code(503).send();
      }
      return reply.code(204).send();
    });
    const hook = `${await receiver.listen({ host: '127.0.0.1', port: 0 })}/v1/webhooks/sales-feeds/reveal`;
    try {
      const created = await fetch(`${base}/reveal-crm/v1/webhooks`, {
        method: 'POST',
        headers: { 'x-api-key': 'rvl_recette_ok_0001', 'content-type': 'application/json' },
        body: JSON.stringify({ url: hook, events: ['sale_created', 'sale_refunded'] }),
      });
      expect(created.status).toBe(201);
      const { secret } = z.object({ secret: z.string() }).parse(await created.json());

      await control('/reveal/sell', { euros: 30, id: 'sale_hook_01' });
      await control('/clock', { advanceSeconds: 20 });
      expect(received).toHaveLength(1);
      await control('/clock', { advanceSeconds: 31 });
      expect(received).toHaveLength(2);

      const last = received[1];
      const t = Number(/t=(\d+)/u.exec(last?.signature ?? '')?.[1]);
      expect(last?.signature).toBe(revealSignature(secret, t, last?.body ?? ''));
      expect(last?.event).toBe('sale_created');
      expect(last?.body).toContain('sale_hook_01');
      const state = z
        .object({
          reveal: z.object({ envois: z.array(z.object({ statut: z.string(), essais: z.number() })) }),
        })
        .parse(await (await fetch(`${base}/__`)).json());
      expect(state.reveal.envois.at(-1)).toEqual(expect.objectContaining({ statut: 'succeeded', essais: 2 }));
    } finally {
      await receiver.close();
    }
  });

  it('sends nothing off this machine', async () => {
    const created = await fetch(`${base}/reveal-crm/v1/webhooks`, {
      method: 'POST',
      headers: { 'x-api-key': 'rvl_recette_ok_0001', 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://192.0.2.10/hook', events: ['sale_created'] }),
    });
    expect(created.status).toBe(400);
  });
});
