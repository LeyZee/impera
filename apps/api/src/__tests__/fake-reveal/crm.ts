import { createHmac } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SalesFeedFetch } from '../../modules/connectors';

/**
 * FakeReveal's CRM API (docs/reference/fake-reveal.md § API CRM, ADR 0050 § 9): the documented routes of
 * `api.reveal.me`, behind `x-api-key`, over an in-memory register. Everything is invented (`model_test_01`,
 * `fan_test_01`); the shapes follow Reveal's documentation, read on 2026-11-02, until a real answer is seen.
 * Test-only: nothing in `src` outside `__tests__` imports it.
 */

export const FAKE_CRM_KEY = 'rvl_fake_key_for_tests_only';
export const FAKE_CRM_BASE_URL = 'https://fake-reveal.test';

export interface FakeSale {
  readonly id: string;
  readonly modelId: string;
  readonly type: string;
  readonly status: string;
  readonly createdAt: string;
  readonly amountTtc: number;
  readonly amountHt: number;
  readonly agencyRevenue: number;
  readonly modelRevenue: number;
  /** `agencyRevenue + modelRevenue` unless a test breaks it on purpose. */
  readonly netAmount?: number;
  readonly fan: { readonly memberId: string; readonly userName: string } | null;
  readonly chatterId: string | null;
}

interface RegisterLine {
  readonly cursor: string;
  readonly event: string;
  readonly occurredAt: string;
  readonly sale: FakeSale;
}

export interface FakeCrm {
  readonly app: FastifyInstance;
  /** `fetch` for the adapter, served by `app.inject`. */
  readonly fetch: SalesFeedFetch;
  /** Appends a sale to the register (in the register's order, whatever its date: a late 3-D Secure comes last). */
  sell(sale: Partial<FakeSale> & Pick<FakeSale, 'id'>): string;
  /** Appends the refund of a sale already sold, with its amounts. */
  refund(saleId: string, occurredAt: string): string;
  /** Appends a raw line, for an event Impera does not know. */
  appendRaw(event: string, sale: FakeSale, occurredAt: string): string;
  /** The next `requests` calls answer 429 with this `Retry-After`. */
  rateLimit(requests: number, retryAfterSeconds: number): void;
  /** The key is revoked: every call answers 401. */
  revoke(): void;
  /** The key loses an access: its routes answer 403 (`webhooks`: not opened by the support). */
  withhold(access: Access): void;
  /**
   * The statistics are computed from the register from now on, as Reveal does (a sale on its day in Europe/Paris, a
   * refund taken off its sale's day), instead of the fixed day the other tests read.
   */
  statsFromRegister(): void;
  /** `/v1/sales` answers without `pageInfo` this many times. */
  breakShape(times: number): void;
  /** The register's position of a sale's line, `null` when none. */
  positionOf(saleId: string): string | null;
  readonly calls: { readonly method: string; readonly path: string; readonly status: number }[];
  /** The webhooks registered, by id: what Reveal would post to. */
  readonly webhooks: ReadonlyMap<string, { readonly url: string; readonly secret: string }>;
  /**
   * The delivery Reveal would post for a line of the register: its raw body and its headers, signed with the webhook's
   * secret (`secret` and `t` overridable to forge one).
   */
  delivery(
    position: string,
    options?: {
      readonly webhookId?: string;
      readonly secret?: string;
      readonly t?: number;
      readonly id?: string;
    },
  ): { readonly body: string; readonly headers: Record<string, string> };
}

type Access = 'stats' | 'sales' | 'webhooks';

/** `X-Reveal-Signature: t=<seconds>,v1=<hex>`, `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`. */
export function revealSignature(secret: string, t: number, body: string): string {
  return `t=${String(t)},v1=${createHmac('sha256', secret)
    .update(`${String(t)}.${body}`)
    .digest('hex')}`;
}

const DEFAULT_SALE: Omit<FakeSale, 'id'> = {
  modelId: 'model_test_01',
  type: 'ppv',
  status: 'paid',
  createdAt: '2026-10-20T18:00:00.000Z',
  amountTtc: 1200,
  amountHt: 1000,
  agencyRevenue: 300,
  modelRevenue: 500,
  fan: { memberId: 'member_test_01', userName: 'fan_test_01' },
  chatterId: 'chatter_test_01',
};

export function createFakeCrm(): FakeCrm {
  const app = Fastify();
  const register: RegisterLine[] = [];
  const state = {
    revoked: false,
    withheld: new Set<Access>(),
    rateLimited: 0,
    retryAfterSeconds: 0,
    brokenShapes: 0,
    liveStats: false,
  };
  const calls: { method: string; path: string; status: number }[] = [];
  const webhooks = new Map<string, { url: string; secret: string }>();
  let counter = 1000;

  const append = (event: string, sale: FakeSale, occurredAt: string): string => {
    counter += 1;
    const cursor = String(counter);
    register.push({ cursor, event, occurredAt, sale });
    return cursor;
  };

  const wire = (line: RegisterLine) => ({
    cursor: line.cursor,
    event: line.event,
    occurredAt: line.occurredAt,
    sale: {
      ...line.sale,
      refundedAt: null,
      netAmount: line.sale.netAmount ?? line.sale.agencyRevenue + line.sale.modelRevenue,
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? request.url;
    const { method } = request;
    const answer = (status: number, body: object) => {
      calls.push({ method, path, status });
      return reply.code(status).send(body);
    };
    if (state.rateLimited > 0) {
      state.rateLimited -= 1;
      void reply.header('retry-after', String(state.retryAfterSeconds));
      return answer(429, { error: 'rate_limited' });
    }
    if (state.revoked || request.headers['x-api-key'] !== FAKE_CRM_KEY) {
      return answer(401, { error: 'unauthorized' });
    }
    const access: Access = path.startsWith('/v1/sales')
      ? 'sales'
      : path.startsWith('/v1/webhooks')
        ? 'webhooks'
        : 'stats';
    if (state.withheld.has(access)) return answer(403, { error: 'forbidden' });
    calls.push({ method, path, status: 200 });
    return undefined;
  });

  app.get('/v1/sales', (request) => {
    const query = z
      .object({ since: z.string().optional(), take: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(request.query);
    const start = query.since === undefined ? 0 : register.findIndex((l) => l.cursor === query.since) + 1;
    const page = register.slice(start, start + query.take);
    const hasNextPage = start + query.take < register.length;
    if (state.brokenShapes > 0) {
      state.brokenShapes -= 1;
      return { currency: 'EUR', data: page.map(wire) };
    }
    return {
      currency: 'EUR',
      data: page.map(wire),
      pageInfo: { hasNextPage, endCursor: page.at(-1)?.cursor ?? query.since ?? null },
    };
  });

  app.get('/v1/models', () => ({
    data: [
      {
        modelId: 'model_test_01',
        userName: 'creatrice_test',
        displayName: 'Créatrice test',
        avatarUrl: null,
        isActive: true,
        status: 'validated',
        subscribersCount: 0,
        subscriptionPrice: 0,
        subscriptionPlans: [{ periodicity: 'oneMonth', price: 0 }],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        modelId: 'model_test_02',
        userName: 'autre_test',
        displayName: 'Autre test',
        avatarUrl: null,
        isActive: true,
        status: 'pending',
        subscribersCount: 0,
        subscriptionPrice: null,
        subscriptionPlans: [],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }));

  app.get('/v1/chatters', () => ({
    data: [
      {
        chatterId: 'chatter_test_01',
        firstName: 'Chatteur',
        lastName: 'Test',
        email: null,
        role: 'chatter',
        isBot: false,
        isExternal: false,
        removedAt: null,
        modelIds: ['model_test_01'],
      },
      {
        chatterId: 'bot_test_01',
        firstName: 'Bot',
        lastName: 'Test',
        email: null,
        role: 'chatter',
        isBot: true,
        isExternal: false,
        removedAt: null,
        modelIds: ['model_test_01'],
      },
    ],
  }));

  const statsQuery = z.object({ from: z.iso.date(), to: z.iso.date() });
  const parisDay = (at: string): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(at));

  /** The register summed per day of each sale (a refund counted against it) and per `key` of its sale. */
  const summed = (from: string, to: string, keyOf: (sale: FakeSale) => string) => {
    const sums = new Map<
      string,
      { date: string; sale: FakeSale; count: number; ttc: number; ht: number; agency: number; model: number }
    >();
    for (const line of register) {
      const date = parisDay(line.sale.createdAt);
      if (date < from || date > to) continue;
      const sign = line.event === 'sale_refunded' ? -1 : 1;
      const key = `${date}|${keyOf(line.sale)}`;
      const sum = sums.get(key) ?? { date, sale: line.sale, count: 0, ttc: 0, ht: 0, agency: 0, model: 0 };
      sums.set(key, {
        ...sum,
        count: sum.count + sign,
        ttc: sum.ttc + sign * line.sale.amountTtc,
        ht: sum.ht + sign * line.sale.amountHt,
        agency: sum.agency + sign * line.sale.agencyRevenue,
        model: sum.model + sign * line.sale.modelRevenue,
      });
    }
    return [...sums.values()];
  };

  const liveDaily = (from: string, to: string) =>
    summed(from, to, (sale) => sale.modelId).map((sum) => ({
      date: sum.date,
      modelId: sum.sale.modelId,
      newSubscribers: 0,
      unsubscribes: 0,
      activeSubscribers: 0,
      revenueTtc: sum.ttc,
      revenueHt: sum.ht,
      agencyRevenue: sum.agency,
      modelRevenue: sum.model,
      ppvSent: null,
      ppvPurchased: 0,
      ppvRevenueTtc: 0,
      tipsCount: 0,
      tipsRevenueTtc: 0,
      renewals: 0,
      paymentLinksCount: 0,
      boudoirCount: 0,
      paidMessagesCount: 0,
      subscriptionsNetRevenue: 0,
      renewalsNetRevenue: 0,
      ppvNetRevenue: 0,
      tipsNetRevenue: 0,
      paymentLinksNetRevenue: 0,
      boudoirNetRevenue: 0,
      paidMessagesNetRevenue: 0,
      otherNetRevenue: sum.agency + sum.model,
      messagesSent: null,
      messagesReceived: null,
    }));

  const liveChatters = (from: string, to: string) =>
    summed(from, to, (sale) => `${sale.modelId}|${sale.chatterId ?? ''}`).map((sum) => ({
      date: sum.date,
      chatterId: sum.sale.chatterId,
      modelId: sum.sale.modelId,
      salesCount: sum.count,
      revenueTtc: sum.ttc,
      revenueHt: sum.ht,
      agencyRevenue: sum.agency,
      modelRevenue: sum.model,
      netRevenue: sum.agency + sum.model,
      ppvPurchased: 0,
      ppvNetRevenue: 0,
      tipsCount: 0,
      tipsNetRevenue: 0,
      messagesSent: null,
      ppvSent: null,
    }));

  app.get('/v1/stats/daily', (request) => {
    const { from, to } = statsQuery.parse(request.query);
    if (state.liveStats) {
      return { from, to, timezone: 'Europe/Paris', currency: 'EUR', models: [], data: liveDaily(from, to) };
    }
    return {
      from,
      to,
      timezone: 'Europe/Paris',
      currency: 'EUR',
      generatedAt: '2026-10-21T08:00:00.000Z',
      models: [{ modelId: 'model_test_01', userName: 'creatrice_test', displayName: 'Créatrice test' }],
      data: [
        {
          date: from,
          modelId: 'model_test_01',
          newSubscribers: 2,
          unsubscribes: 0,
          activeSubscribers: 40,
          revenueTtc: 1200,
          revenueHt: 1000,
          agencyRevenue: 300,
          modelRevenue: 500,
          ppvSent: null,
          ppvPurchased: 1,
          ppvRevenueTtc: 1200,
          tipsCount: 0,
          tipsRevenueTtc: 0,
          renewals: 0,
          paymentLinksCount: 0,
          boudoirCount: 0,
          paidMessagesCount: 0,
          subscriptionsNetRevenue: 0,
          renewalsNetRevenue: 0,
          ppvNetRevenue: 800,
          tipsNetRevenue: 0,
          paymentLinksNetRevenue: 0,
          boudoirNetRevenue: 0,
          paidMessagesNetRevenue: 0,
          otherNetRevenue: 0,
          messagesSent: null,
          messagesReceived: null,
        },
      ],
    };
  });

  app.get('/v1/stats/chatters/daily', (request) => {
    const { from, to } = statsQuery.parse(request.query);
    if (state.liveStats) {
      return {
        from,
        to,
        timezone: 'Europe/Paris',
        currency: 'EUR',
        chatters: [],
        data: liveChatters(from, to),
      };
    }
    return {
      from,
      to,
      timezone: 'Europe/Paris',
      currency: 'EUR',
      generatedAt: '2026-10-21T08:00:00.000Z',
      chatters: [],
      data: [
        {
          date: from,
          chatterId: 'chatter_test_01',
          modelId: 'model_test_01',
          salesCount: 1,
          revenueTtc: 1200,
          revenueHt: 1000,
          agencyRevenue: 300,
          modelRevenue: 500,
          netRevenue: 800,
          ppvPurchased: 1,
          ppvNetRevenue: 800,
          tipsCount: 0,
          tipsNetRevenue: 0,
          messagesSent: 12,
          ppvSent: 3,
        },
        {
          date: from,
          chatterId: null,
          modelId: 'model_test_01',
          salesCount: 0,
          revenueTtc: 0,
          revenueHt: 0,
          agencyRevenue: 0,
          modelRevenue: 0,
          netRevenue: 0,
          ppvPurchased: 0,
          ppvNetRevenue: 0,
          tipsCount: 0,
          tipsNetRevenue: 0,
          messagesSent: null,
          ppvSent: null,
        },
      ],
    };
  });

  app.post('/v1/webhooks', (request, reply) => {
    const body = z
      .object({ url: z.url(), events: z.array(z.enum(['sale_created', 'sale_refunded'])).min(1) })
      .parse(request.body);
    counter += 1;
    const id = `webhook_test_${String(counter)}`;
    const secret = `whsec_test_${String(counter)}`;
    webhooks.set(id, { url: body.url, secret });
    return reply.code(201).send({ id, url: body.url, events: body.events, secret });
  });

  app.delete('/v1/webhooks/:id', (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    return webhooks.delete(id) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
  });

  const fetch: SalesFeedFetch = async (url, init) => {
    const target = new URL(url);
    const response = await app.inject({
      method: init.method ?? 'GET',
      url: `${target.pathname}${target.search}`,
      headers: init.headers,
      ...(init.body === undefined ? {} : { payload: init.body }),
    });
    return {
      status: response.statusCode,
      headers: {
        get: (name) => {
          const value = response.headers[name.toLowerCase()];
          return value === undefined ? null : String(value);
        },
      },
      text: () => Promise.resolve(response.body),
    };
  };

  return {
    app,
    fetch,
    sell(sale) {
      const full: FakeSale = { ...DEFAULT_SALE, ...sale };
      return append('sale_created', full, full.createdAt);
    },
    refund(saleId, occurredAt) {
      const sold = register.find((line) => line.sale.id === saleId && line.event === 'sale_created');
      if (sold === undefined) throw new Error(`no sale ${saleId}`);
      return append('sale_refunded', { ...sold.sale, status: 'refunded' }, occurredAt);
    },
    appendRaw: append,
    rateLimit(requests, retryAfterSeconds) {
      state.rateLimited = requests;
      state.retryAfterSeconds = retryAfterSeconds;
    },
    revoke() {
      state.revoked = true;
    },
    withhold(access) {
      state.withheld.add(access);
    },
    statsFromRegister() {
      state.liveStats = true;
    },
    breakShape(times) {
      state.brokenShapes = times;
    },
    positionOf: (saleId) =>
      register.find((line) => line.sale.id === saleId && line.event === 'sale_created')?.cursor ?? null,
    calls,
    webhooks,
    delivery(position, options = {}) {
      const line = register.find((candidate) => candidate.cursor === position);
      if (line === undefined) throw new Error(`no line at ${position}`);
      const webhook =
        options.webhookId === undefined ? [...webhooks.values()].at(-1) : webhooks.get(options.webhookId);
      const secret = options.secret ?? webhook?.secret;
      if (secret === undefined) throw new Error('no webhook registered');
      const body = JSON.stringify({
        id: options.id ?? `delivery_${position}`,
        event: line.event,
        createdAt: line.occurredAt,
        data: wire(line),
      });
      const t = options.t ?? Math.floor(Date.now() / 1000);
      return {
        body,
        headers: {
          'content-type': 'application/json',
          'x-reveal-signature': revealSignature(secret, t, body),
        },
      };
    },
  };
}
