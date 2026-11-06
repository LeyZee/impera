import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';

import { isLoopbackUrl } from '../../sandbox';
import { createFakeCrm, DEFAULT_MODELS, IMPORT_MODELS, type FakeCrm } from '../fake-reveal/crm';

/**
 * The recette sandbox's fake world (ADR 0075, docs/recette/bac-a-sable.md): one local HTTP server that answers at the
 * addresses Impera calls, under a path per service: `/xai`, `/google`, `/mistral`, `/elevenlabs` (the routes the key
 * verifiers read) and `/reveal-crm` (FakeReveal's CRM API). The API keeps its real adapters and verifiers; only their
 * base address points here. Everything is invented (ADR 0010). Not a test: run by `pnpm sandbox:world`, it lives
 * beside FakeReveal, which it reuses, and never reaches the production image (tsup builds `index.ts` and `worker.ts`).
 *
 * A key decides its own fate, as a real one would: one with `refus` in it is refused, `credit` has no credit left,
 * `limite` is rate limited (429), `panne` finds the service down (503); any other is accepted. The control routes
 * under `/__` change a whole service afterwards (a key revoked at the provider, an outage) and make Reveal sell.
 *
 * Reveal's side keeps Reveal's rules (its « CRM / API » documentation): rate limits counted, the messages counted the
 * night after the key, and every sale delivered for real to the webhooks Impera registers, signed, 15 s after the sale
 * on the world's clock, retried on failure. The clock can be moved forward (`/__/clock`) to play the retries or the
 * night without waiting. Deliveries go to this machine only.
 */

export const AI_SERVICES = ['xai', 'google', 'mistral', 'elevenlabs'] as const;
export type AiService = (typeof AI_SERVICES)[number];

/** What a service does with the next calls: `auto` reads the key, the others force an answer for every key. */
export const SERVICE_MODES = ['auto', 'ok', 'refused', 'no_credit', 'rate_limited', 'down'] as const;
export type ServiceMode = (typeof SERVICE_MODES)[number];

type Outcome = Exclude<ServiceMode, 'auto'>;

/** The fate a key's own words give it (`auto`). */
export function outcomeOfKey(key: string): Outcome {
  const words = key.toLowerCase();
  if (words.includes('refus')) return 'refused';
  if (words.includes('credit')) return 'no_credit';
  if (words.includes('limite')) return 'rate_limited';
  if (words.includes('panne')) return 'down';
  return 'ok';
}

/** A Reveal CRM key the fake world takes: Reveal's prefix, and not one that asks to be refused. */
export const isAcceptedRevealKey = (key: string): boolean =>
  key.startsWith('rvl_') && outcomeOfKey(key) === 'ok';

export interface World {
  readonly app: FastifyInstance;
  readonly crm: FakeCrm;
  readonly modes: Readonly<Record<AiService, ServiceMode>>;
  /** Stops sending the deliveries (the world's `onClose` does it too). */
  stop(): void;
}

const keyOf = (request: FastifyRequest, header: string): string => {
  const value = request.headers[header];
  const raw = typeof value === 'string' ? value : '';
  return raw.replace(/^Bearer\s+/iu, '');
};

/** The methods the fake CRM is asked with; anything else is not a Reveal call. */
const INJECTABLE_METHODS = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

const SaleBodySchema = z.object({
  id: z.string().min(1).max(64).optional(),
  modelId: z.string().min(1).max(64).default('model_test_01'),
  type: z
    .enum([
      'subscription',
      'renewal',
      'ppv',
      'mass_dm',
      'tip',
      'payment_link',
      'boudoir',
      'paid_message',
      'other',
    ])
    .default('ppv'),
  /** Euros, TTC; the parts follow Reveal's usual split of an invented sale. */
  euros: z.number().positive().max(10_000).default(12),
  /** The bot by default for the sales a chatter makes; nobody for the others, as Reveal attributes them. */
  chatterId: z.string().min(1).max(64).nullable().optional(),
  at: z.iso.datetime().optional(),
  /** Confirmed late (3-D Secure): its date is this many minutes before now, yet it comes last in the register. */
  lateMinutes: z.number().int().min(1).max(1440).optional(),
});

/** Sales Reveal gives to nobody: subscriptions, renewals, payment links, boudoir, Mass DM. */
const SOLD_BY_NOBODY = new Set(['subscription', 'renewal', 'payment_link', 'boudoir', 'mass_dm']);

/** Posts a delivery to Impera on this machine; anywhere else is refused as unreachable. */
async function deliverLocally(url: string, body: string, headers: Record<string, string>): Promise<number> {
  if (!isLoopbackUrl(url)) return 0;
  const response = await fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(10_000) });
  return response.status;
}

export function createWorld(
  options: {
    readonly now?: () => Date;
    readonly deliver?: typeof deliverLocally;
    readonly limits?: boolean;
  } = {},
): World {
  const clock = options.now ?? (() => new Date());
  let offsetMs = 0;
  const now = () => new Date(clock().getTime() + offsetMs);
  const app = Fastify();
  const crm = createFakeCrm({
    acceptKey: isAcceptedRevealKey,
    now,
    limits: options.limits ?? true,
    allowLoopbackHttp: true,
    deliver: options.deliver ?? deliverLocally,
  });
  crm.statsFromRegister();
  const pump = setInterval(() => void crm.pumpDeliveries(), 1000);
  pump.unref();
  const stop = () => {
    clearInterval(pump);
  };
  app.addHook('onClose', (_instance, done) => {
    stop();
    done();
  });
  const modes: Record<AiService, ServiceMode> = {
    xai: 'auto',
    google: 'auto',
    mistral: 'auto',
    elevenlabs: 'auto',
  };
  let sales = 0;

  const outcome = (service: AiService, key: string): Outcome => {
    const mode = modes[service];
    return mode === 'auto' ? outcomeOfKey(key) : mode;
  };

  /** The answers every service shares for a key that is not fine. */
  const trouble = (reply: FastifyReply, result: Outcome): FastifyReply | null => {
    if (result === 'rate_limited')
      return reply.code(429).header('retry-after', '30').send({ error: 'rate limited' });
    if (result === 'down') return reply.code(503).send({ error: 'service unavailable' });
    return null;
  };

  // xAI: `GET /v1/api-key` describes the key (its verifier); generation is not simulated yet (ADR 0075, phase 2).
  app.get('/xai/v1/api-key', (request, reply) => {
    const result = outcome('xai', keyOf(request, 'authorization'));
    if (trouble(reply, result) !== null) return reply;
    if (result === 'refused') return reply.code(401).send({ error: 'Incorrect API key provided' });
    if (result === 'no_credit') return reply.code(403).send({ error: 'Your team has run out of credits' });
    return {
      name: 'Clé de recette',
      acls: [],
      api_key_blocked: false,
      api_key_disabled: false,
      team_blocked: false,
    };
  });

  // Google: the model list, with the vision model Impera asks for and the one it compares with.
  app.get('/google/v1beta/models', (request, reply) => {
    const result = outcome('google', keyOf(request, 'x-goog-api-key'));
    if (trouble(reply, result) !== null) return reply;
    if (result === 'refused') {
      return reply.code(400).send({ error: { status: 'INVALID_ARGUMENT', message: 'API key not valid.' } });
    }
    if (result === 'no_credit') return reply.code(403).send({ error: { status: 'PERMISSION_DENIED' } });
    return {
      models: [
        { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash' },
        { name: 'models/gemini-4-argon', displayName: 'Gemini 4 Argon' },
      ],
    };
  });

  // Mistral: the model list, Mistral Large in it.
  app.get('/mistral/v1/models', (request, reply) => {
    const result = outcome('mistral', keyOf(request, 'authorization'));
    if (trouble(reply, result) !== null) return reply;
    if (result === 'refused') return reply.code(401).send({ message: 'Unauthorized' });
    if (result === 'no_credit') return reply.code(402).send({ message: 'Payment required' });
    return { data: [{ id: 'mistral-large-latest' }, { id: 'mistral-small-latest' }] };
  });

  // ElevenLabs: the month's characters (almost spent for `credit`) and the voices, one named after Messa.
  const elevenlabs = (body: () => object) => (request: FastifyRequest, reply: FastifyReply) => {
    const result = outcome('elevenlabs', keyOf(request, 'xi-api-key'));
    if (trouble(reply, result) !== null) return reply;
    if (result === 'refused') {
      return reply.code(401).send({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
    }
    return result === 'no_credit' && request.url.endsWith('/subscription')
      ? { character_count: 99_000, character_limit: 100_000 }
      : body();
  };
  app.get(
    '/elevenlabs/v1/user/subscription',
    elevenlabs(() => ({ character_count: 12_000, character_limit: 100_000 })),
  );
  app.get(
    '/elevenlabs/v1/voices',
    elevenlabs(() => ({
      voices: [
        { voice_id: 'voice_recette_messa', name: 'Messa (recette)' },
        { voice_id: 'voice_recette_autre', name: 'Autre voix (recette)' },
      ],
    })),
  );

  // Any other route of an AI service, generation included: not simulated yet, answered as an outage.
  for (const service of AI_SERVICES) {
    app.all(`/${service}/*`, (_request, reply) =>
      reply.code(503).send({ error: 'not simulated by the sandbox yet (ADR 0075)' }),
    );
  }

  // Reveal's CRM API: FakeReveal's, served under `/reveal-crm`.
  app.all('/reveal-crm/*', async (request, reply) => {
    const url = request.url.replace(/^\/reveal-crm/u, '');
    const headers = Object.fromEntries(
      Object.entries(request.headers).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'host',
      ),
    );
    const answer = await crm.app.inject({
      method: INJECTABLE_METHODS.parse(request.method),
      url,
      headers,
      ...(request.body === undefined ? {} : { payload: JSON.stringify(request.body) }),
    });
    for (const [name, value] of Object.entries(answer.headers)) {
      if (value !== undefined && name !== 'content-length' && name !== 'connection') {
        void reply.header(name, value);
      }
    }
    return reply.code(answer.statusCode).send(answer.body);
  });

  // ---- Control (`/__`): what a recette agent or Charles does to the world.

  app.get('/__', () => ({
    monde: 'Bac à sable de recette (ADR 0075) : rien n’est réel',
    services: modes,
    horloge: now().toISOString(),
    reveal: {
      ventes: sales,
      appels: crm.calls.length,
      webhooks: [...crm.webhooks.entries()].map(([id, webhook]) => ({
        id,
        url: webhook.url,
        actif: webhook.isActive,
      })),
      envois: crm.deliveries.slice(-20).map((delivery) => ({
        id: delivery.id,
        position: delivery.cursor,
        evenement: delivery.event,
        statut: delivery.status,
        essais: delivery.attempts,
        dernierCode: delivery.lastStatusCode,
        prochainEssai: delivery.nextAttemptAt,
      })),
    },
    cles: {
      regle:
        'Une clé contenant « refus » est refusée, « credit » sans crédit, « limite » limitée (429), « panne » en panne (503) ; toute autre est acceptée. Une clé Reveal commence par rvl_.',
      exemples: {
        xai: ['xai-recette-ok-0000000001', 'xai-recette-refus-000000001'],
        google: ['AIza-recette-ok-0000000001', 'AIza-recette-credit-00000001'],
        mistral: ['mistral-recette-ok-000001', 'mistral-recette-panne-0001'],
        elevenlabs: ['sk_recette_ok_000000000001', 'sk_recette_limite_00000001'],
        reveal: ['rvl_recette_ok_0001', 'rvl_recette_refus_0001'],
      },
    },
  }));

  app.post('/__/services/:service', (request, reply) => {
    const params = z.object({ service: z.enum(AI_SERVICES) }).safeParse(request.params);
    const body = z.object({ mode: z.enum(SERVICE_MODES) }).safeParse(request.body);
    if (!params.success || !body.success) {
      return reply
        .code(400)
        .send({ error: `service parmi ${AI_SERVICES.join(', ')}, mode parmi ${SERVICE_MODES.join(', ')}` });
    }
    modes[params.data.service] = body.data.mode;
    return { service: params.data.service, mode: body.data.mode };
  });

  app.post('/__/reveal/sell', (request, reply) => {
    const body = SaleBodySchema.safeParse(request.body ?? {});
    if (!body.success)
      return reply.code(400).send({ error: body.error.issues.map((issue) => issue.message) });
    sales += 1;
    const { euros } = body.data;
    const amountTtc = Math.round(euros * 100);
    const amountHt = Math.round(amountTtc / 1.2);
    const agencyRevenue = Math.round(amountHt * 0.3);
    const modelRevenue = Math.round(amountHt * 0.5);
    const id = body.data.id ?? `sale_recette_${String(sales).padStart(4, '0')}`;
    const position = crm.sell({
      id,
      modelId: body.data.modelId,
      type: body.data.type,
      createdAt:
        body.data.at ?? new Date(now().getTime() - (body.data.lateMinutes ?? 0) * 60_000).toISOString(),
      amountTtc,
      amountHt,
      agencyRevenue,
      modelRevenue,
      // A payment link needs no account: no fan.
      fan:
        body.data.type === 'payment_link'
          ? null
          : { memberId: `member_recette_${String(sales)}`, userName: `fan_recette_${String(sales)}` },
      chatterId: body.data.chatterId ?? (SOLD_BY_NOBODY.has(body.data.type) ? null : 'bot_test_01'),
    });
    return { id, position, net: (agencyRevenue + modelRevenue) / 100 };
  });

  app.post('/__/reveal/refund', (request, reply) => {
    const body = z.object({ saleId: z.string().min(1) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'saleId attendu' });
    try {
      return { position: crm.refund(body.data.saleId, now().toISOString()) };
    } catch {
      return reply.code(404).send({ error: `aucune vente ${body.data.saleId}` });
    }
  });

  const KeyBody = z.object({
    state: z.enum(['revoked', 'restored', 'no_sales', 'no_stats', 'no_webhooks', 'limited']),
    modelIds: z.array(z.string().min(1)).min(1).optional(),
  });
  app.post('/__/reveal/key', (request, reply) => {
    const body = KeyBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: 'state : revoked, restored, no_sales, no_stats, no_webhooks ou limited (avec modelIds)',
      });
    }
    const { state, modelIds } = body.data;
    if (state === 'revoked') crm.revoke();
    else if (state === 'restored') crm.restore();
    else if (state === 'no_sales') crm.withhold('sales');
    else if (state === 'no_stats') crm.withhold('stats');
    else if (state === 'no_webhooks') crm.withhold('webhooks');
    else crm.limitTo(modelIds ?? ['model_test_01']);
    return body.data;
  });

  app.post('/__/reveal/nightly', (request, reply) => {
    const body = z.object({ done: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'done : true ou false' });
    crm.setNightlyDone(body.data.done);
    return body.data;
  });

  app.post('/__/reveal/count-timeout', (request, reply) => {
    const body = z.object({ on: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'on : true ou false' });
    crm.setCountTimeout(body.data.on);
    return body.data;
  });

  const WebhookControl = z.object({
    outage: z.boolean().optional(),
    shuffle: z.boolean().optional(),
    duplicateNext: z.number().int().min(0).max(100).optional(),
    failNext: z.number().int().min(0).max(100).optional(),
  });
  app.post('/__/reveal/webhooks', (request, reply) => {
    const body = WebhookControl.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'outage, shuffle (booléens), duplicateNext, failNext (nombres)' });
    }
    const { outage, shuffle, duplicateNext, failNext } = body.data;
    if (outage !== undefined) crm.setWebhookOutage(outage);
    if (shuffle !== undefined) crm.setShuffle(shuffle);
    if (duplicateNext !== undefined) crm.duplicateNext(duplicateNext);
    if (failNext !== undefined) crm.failNext(failNext);
    return body.data;
  });

  app.post('/__/clock', async (request, reply) => {
    const body = z
      .object({
        advanceSeconds: z
          .number()
          .int()
          .min(1)
          .max(7 * 86_400),
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'advanceSeconds : de 1 à 604800' });
    offsetMs += body.data.advanceSeconds * 1000;
    await crm.pumpDeliveries();
    return { now: now().toISOString() };
  });

  app.post('/__/reveal/rate-limit', (request, reply) => {
    const body = z
      .object({ requests: z.number().int().min(1).max(100), retryAfter: z.number().int().min(1).max(3600) })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'requests (1–100) et retryAfter (secondes)' });
    crm.rateLimit(body.data.requests, body.data.retryAfter);
    return body.data;
  });

  app.post('/__/reveal/models', (request, reply) => {
    const body = z.object({ preset: z.enum(['default', 'import']) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'preset : default ou import' });
    crm.setModels(body.data.preset === 'import' ? IMPORT_MODELS : DEFAULT_MODELS);
    return body.data;
  });

  return { app, crm, modes, stop };
}
