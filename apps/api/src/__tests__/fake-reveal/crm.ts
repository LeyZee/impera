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
  /** Appends a raw line, for an event Nirvana does not know. */
  appendRaw(event: string, sale: FakeSale, occurredAt: string): string;
  /** The next `requests` calls answer 429 with this `Retry-After`. */
  rateLimit(requests: number, retryAfterSeconds: number): void;
  /** The key is revoked: every call answers 401. */
  revoke(): void;
  /** The key loses an access: its routes answer 403. */
  withhold(access: 'stats' | 'sales'): void;
  /** `/v1/sales` answers without `pageInfo` this many times. */
  breakShape(times: number): void;
  readonly calls: { readonly path: string; readonly status: number }[];
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
    withheld: new Set<'stats' | 'sales'>(),
    rateLimited: 0,
    retryAfterSeconds: 0,
    brokenShapes: 0,
  };
  const calls: { path: string; status: number }[] = [];
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
    const answer = (status: number, body: object) => {
      calls.push({ path, status });
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
    const access = path.startsWith('/v1/sales') ? 'sales' : 'stats';
    if (state.withheld.has(access)) return answer(403, { error: 'forbidden' });
    calls.push({ path, status: 200 });
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

  app.get('/v1/stats/daily', (request) => {
    const { from, to } = statsQuery.parse(request.query);
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

  const fetch: SalesFeedFetch = async (url, init) => {
    const target = new URL(url);
    const response = await app.inject({
      method: 'GET',
      url: `${target.pathname}${target.search}`,
      headers: init.headers,
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
    breakShape(times) {
      state.brokenShapes = times;
    },
    calls,
  };
}
