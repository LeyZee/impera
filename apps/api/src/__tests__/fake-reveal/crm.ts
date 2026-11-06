import { createHmac } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';

import type { SalesFeedFetch } from '../../modules/connectors';

import {
  daysBetween,
  TRACKING_DETAIL_SINCE,
  TRACKING_LINKS,
  trackingDay,
  type FakeTrackingLink,
} from './crm-tracking';

/**
 * FakeReveal's CRM API (docs/reference/fake-reveal.md § API CRM, ADR 0050 § 9): the documented routes of
 * `api.reveal.me`, behind `x-api-key`, over an in-memory register. Everything is invented (`model_test_01`,
 * `fan_test_01`); the shapes and the errors follow Reveal's documentation (« CRM / API », read on 2026-11-02 and again
 * on 2026-11-06), until a real answer is seen. Test-only, and the recette sandbox's fake world (`../sandbox-world`,
 * ADR 0075): nothing in `src` outside `__tests__` imports it.
 *
 * What the documentation says and this world does: amounts in euro cents, days in Europe/Paris, days to come left
 * out, 31 days at most per call (400), `since` a position of the register (400 otherwise), `take` 500 at most (400),
 * a key limited to some models (403 outside them), an access missing from the key (403), a revoked key (401), the
 * rate limits (429 with `Retry-After`, when asked: `limits`), the messages counted the night after the key was made
 * (`null` before), the webhooks (10 at most, HTTPS, signed deliveries sent 10–30 s after the sale, retried after
 * 30 s, 1 min, 2 min… an hour at most, 8 times in all, possibly twice, in no promised order), their deliveries and
 * their retry (404 for one unknown or of another key, 409 when not failed or the webhook is off).
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

/** A delivery of a register line to a webhook, as `GET /v1/webhooks/:id/deliveries` shows it. */
export interface FakeDelivery {
  readonly id: string;
  readonly webhookId: string;
  readonly cursor: string;
  readonly event: string;
  /** `pending` until it succeeds, `failed` once the 8 attempts are spent. */
  status: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  lastStatusCode: number | null;
  nextAttemptAt: string | null;
  readonly createdAt: string;
}

interface FakeWebhook {
  readonly id: string;
  url: string;
  events: string[];
  readonly modelId: string | null;
  isActive: boolean;
  readonly secret: string;
  readonly createdAt: string;
  /** The key that made it: another key gets a 404 for it. */
  readonly key: string;
}

/** Posts a delivery; resolves with the receiver's HTTP status, rejects when it cannot be reached in time. */
export type DeliverWebhook = (url: string, body: string, headers: Record<string, string>) => Promise<number>;

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
  /** `/v1/models` lists these from now on (the two default models otherwise). */
  setModels(models: readonly FakeModel[]): void;
  /** The next `requests` calls answer 429 with this `Retry-After`. */
  rateLimit(requests: number, retryAfterSeconds: number): void;
  /** The key is revoked: every call answers 401. */
  revoke(): void;
  /** The key works again, with every access and every model (the recette sandbox's « clé rétablie », ADR 0075). */
  restore(): void;
  /** The key loses an access: its routes answer 403 (`webhooks`: not opened by the support). */
  withhold(access: Access): void;
  /** The key is limited to these models (`null`: the whole agency): 403 outside them, lists cut to them. */
  limitTo(modelIds: readonly string[] | null): void;
  /** The night after the key's creation has passed (`true`) or not: before it, the messages counts are `null`. */
  setNightlyDone(done: boolean): void;
  /** The count of messages per chatter does not finish in time: `null` on every line of the call. */
  setCountTimeout(on: boolean): void;
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
  readonly webhooks: ReadonlyMap<
    string,
    { readonly url: string; readonly secret: string; readonly isActive: boolean }
  >;
  /** Every delivery made so far, oldest first. */
  readonly deliveries: readonly FakeDelivery[];
  /** Reveal's webhooks are down: the lines appended meanwhile get no delivery at all (catch up with `/v1/sales`). */
  setWebhookOutage(on: boolean): void;
  /** The next `count` deliveries sent are sent twice, with the same id. */
  duplicateNext(count: number): void;
  /** The next `count` attempts fail as a receiver that does not answer in 10 s. */
  failNext(count: number): void;
  /** The deliveries due together are sent newest first (the order is not promised). */
  setShuffle(on: boolean): void;
  /** Sends the deliveries due now (needs `deliver`); the sandbox world calls it every second. */
  pumpDeliveries(): Promise<void>;
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

/** A model of `/v1/models`; subscribers and prices are invented, Impera reads neither. */
export interface FakeModel {
  readonly modelId: string;
  readonly userName: string;
  readonly displayName: string;
  readonly isActive: boolean;
  /** Reveal's own words (camelCase), any string to test one Impera does not know. */
  readonly status: string;
  readonly avatarUrl?: string | null;
  readonly subscribersCount?: number;
  /** TTC cents of a month, `0` for a free follow only, `null` without a month's plan. */
  readonly subscriptionPrice?: number | null;
  readonly subscriptionPlans?: readonly { readonly periodicity: string; readonly price: number }[];
}

export const DEFAULT_MODELS: readonly FakeModel[] = [
  {
    modelId: 'model_test_01',
    userName: 'creatrice_test',
    displayName: 'Créatrice test',
    isActive: true,
    status: 'validated',
    subscribersCount: 40,
    subscriptionPrice: 999,
    subscriptionPlans: [
      { periodicity: 'oneMonth', price: 0 },
      { periodicity: 'oneMonth', price: 999 },
      { periodicity: 'threeMonth', price: 2499 },
    ],
  },
  {
    modelId: 'model_test_02',
    userName: 'autre_test',
    displayName: 'Autre test',
    isActive: true,
    status: 'pending',
  },
];

/**
 * Invented models for the import (CRM-07, ADR 0069 § 7): one per status Reveal names and one it does not, an inactive
 * one, one without a display name, one whose handle an account already has (`creatrice_test`) and one whose name
 * another creator already has (`Doublon Test`, to create beforehand). Everything here is invented (ADR 0010).
 */
export const IMPORT_MODELS: readonly FakeModel[] = [
  {
    modelId: 'model_imp_valid',
    userName: 'valide_test',
    displayName: 'Validée Test',
    isActive: true,
    status: 'validated',
    avatarUrl: 'https://cdn.example.test/avatars/valide.jpg',
  },
  {
    modelId: 'model_imp_pending',
    userName: 'attente_test',
    displayName: 'Attente Test',
    isActive: true,
    status: 'pending',
  },
  {
    modelId: 'model_imp_changes',
    userName: 'retouches_test',
    displayName: 'Retouches Test',
    isActive: true,
    status: 'onboardingChangesRequested',
  },
  {
    modelId: 'model_imp_refused',
    userName: 'refusee_test',
    displayName: 'Refusée Test',
    isActive: true,
    status: 'refused',
  },
  {
    modelId: 'model_imp_banned',
    userName: 'bannie_test',
    displayName: 'Bannie Test',
    isActive: false,
    status: 'banned',
  },
  {
    modelId: 'model_imp_unknown',
    userName: 'inconnu_test',
    displayName: 'Inconnu Test',
    isActive: true,
    status: 'suspendedForReview',
  },
  {
    modelId: 'model_imp_inactive',
    userName: 'inactive_test',
    displayName: 'Inactive Test',
    isActive: false,
    status: 'validated',
  },
  {
    modelId: 'model_imp_noname',
    userName: 'sansnom_test',
    displayName: '',
    isActive: true,
    status: 'validated',
    avatarUrl: 'http://cdn.example.test/plain.jpg',
  },
  {
    modelId: 'model_imp_handle',
    userName: 'creatrice_test',
    displayName: 'Pseudo Pris',
    isActive: true,
    status: 'validated',
  },
  {
    modelId: 'model_imp_double',
    userName: 'doublon_reveal',
    displayName: 'Doublon  TEST',
    isActive: true,
    status: 'validated',
  },
];

/** `/v1/models` as the documentation shows a line. */
function wireModel(model: FakeModel) {
  return {
    modelId: model.modelId,
    userName: model.userName,
    displayName: model.displayName,
    avatarUrl: model.avatarUrl ?? null,
    isActive: model.isActive,
    status: model.status,
    subscribersCount: model.subscribersCount ?? 0,
    subscriptionPrice: model.subscriptionPrice ?? 0,
    subscriptionPlans: model.subscriptionPlans ?? [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
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

/** The waits between two attempts of a delivery: 30 s, then doubled, an hour at most; 8 attempts in all. */
const RETRY_DELAYS_SECONDS = [30, 60, 120, 240, 480, 960, 1920, 3600] as const;
const DELIVERY_ATTEMPTS = 8;
/** A sale reaches its webhooks 10 to 30 seconds after the payment; here, 15. */
const FIRST_DELIVERY_SECONDS = 15;
const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_WEBHOOKS = 10;
const MAX_DAYS = 31;

/** Reveal's limits: the two statistics routes share theirs, every route has the general one. */
const LIMITS = {
  statsPerKeyPerMinute: 10,
  statsPerAgencyPerMinute: 20,
  statsPerAgencyPerDay: 500,
  generalPerKeyPerMinute: 200,
} as const;

export interface FakeCrmOptions {
  /** Which `x-api-key` opens the API; `FAKE_CRM_KEY` alone when absent (the recette sandbox takes any key it is told). */
  readonly acceptKey?: (key: string) => boolean;
  /** The world's clock: today, the days to come, the deliveries' times and the limits' windows. */
  readonly now?: () => Date;
  /** Count the calls against Reveal's rate limits (the sandbox); off in the tests, which ask for a 429 themselves. */
  readonly limits?: boolean;
  /** Takes a webhook at `http://127.0.0.1…` (the sandbox: Impera on this machine); Reveal wants public HTTPS. */
  readonly allowLoopbackHttp?: boolean;
  /** Sends the deliveries (`pumpDeliveries`); without it they stay pending, as in the tests that forge them. */
  readonly deliver?: DeliverWebhook;
}

const parisDay = (at: Date | string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(at));

const isLoopbackHttp = (value: string): boolean => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
};

/** Which `/v1/stats/daily` column a sale's type counts in. */
const COLUMN_OF_TYPE: Record<string, string> = {
  subscription: 'subscriptions',
  renewal: 'renewals',
  ppv: 'ppv',
  mass_dm: 'ppv',
  tip: 'tips',
  payment_link: 'paymentLinks',
  boudoir: 'boudoir',
  paid_message: 'paidMessages',
};

export function createFakeCrm(options: FakeCrmOptions = {}): FakeCrm {
  const acceptKey = options.acceptKey ?? ((key: string) => key === FAKE_CRM_KEY);
  const now = options.now ?? (() => new Date());
  const app = Fastify();
  const register: RegisterLine[] = [];
  let scope: readonly string[] | null = null;
  const state = {
    revoked: false,
    withheld: new Set<Access>(),
    rateLimited: 0,
    retryAfterSeconds: 0,
    brokenShapes: 0,
    liveStats: false,
    nightlyDone: false,
    countTimeout: false,
    outage: false,
    duplicates: 0,
    failures: 0,
    shuffle: false,
  };
  const calls: { method: string; path: string; status: number }[] = [];
  const webhooks = new Map<string, FakeWebhook>();
  const deliveries: FakeDelivery[] = [];
  const windows = new Map<string, number[]>();
  let models: readonly FakeModel[] = DEFAULT_MODELS;
  let counter = 1000;

  const inScope = (modelId: string): boolean => scope === null || scope.includes(modelId);

  const after = (seconds: number): string => new Date(now().getTime() + seconds * 1000).toISOString();

  const append = (event: string, sale: FakeSale, occurredAt: string): string => {
    counter += 1;
    const cursor = String(counter);
    register.push({ cursor, event, occurredAt, sale });
    if (!state.outage) {
      for (const webhook of webhooks.values()) {
        const wanted =
          webhook.isActive &&
          webhook.events.includes(event) &&
          (webhook.modelId === null || webhook.modelId === sale.modelId);
        if (!wanted) continue;
        counter += 1;
        deliveries.push({
          id: `delivery_test_${String(counter)}`,
          webhookId: webhook.id,
          cursor,
          event,
          status: 'pending',
          attempts: 0,
          lastStatusCode: null,
          nextAttemptAt: after(FIRST_DELIVERY_SECONDS),
          createdAt: now().toISOString(),
        });
      }
    }
    return cursor;
  };

  /** A line as `/v1/sales` and the deliveries show it: the sale at its status of the moment of reading. */
  const wire = (line: RegisterLine) => {
    const refund = register.find(
      (other) => other.event === 'sale_refunded' && other.sale.id === line.sale.id,
    );
    const refunded = refund !== undefined && line.event !== 'sale_refunded' && line.sale.status === 'paid';
    return {
      cursor: line.cursor,
      event: line.event,
      occurredAt: line.occurredAt,
      sale: {
        ...line.sale,
        status: refunded ? 'refunded' : line.sale.status,
        refundedAt: refund?.occurredAt ?? null,
        netAmount: line.sale.netAmount ?? line.sale.agencyRevenue + line.sale.modelRevenue,
      },
    };
  };

  /** Counts a call in a window; the seconds to wait when the window is full, `null` when it may pass. */
  const spend = (name: string, limit: number, windowMs: number): number | null => {
    const at = now().getTime();
    const kept = (windows.get(name) ?? []).filter((time) => time > at - windowMs);
    if (kept.length >= limit) {
      windows.set(name, kept);
      return Math.max(1, Math.ceil(((kept[0] ?? at) + windowMs - at) / 1000));
    }
    kept.push(at);
    windows.set(name, kept);
    return null;
  };

  const limited = (key: string, path: string): number | null => {
    if (options.limits !== true) return null;
    const general = spend(`general|${key}`, LIMITS.generalPerKeyPerMinute, 60_000);
    if (general !== null) return general;
    if (path !== '/v1/stats/daily' && path !== '/v1/stats/chatters/daily') return null;
    return (
      spend(`stats|${key}`, LIMITS.statsPerKeyPerMinute, 60_000) ??
      spend('stats|agency', LIMITS.statsPerAgencyPerMinute, 60_000) ??
      spend(`stats|agency|${parisDay(now())}`, LIMITS.statsPerAgencyPerDay, 86_400_000)
    );
  };

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
    const key = request.headers['x-api-key'];
    if (state.revoked || typeof key !== 'string' || !acceptKey(key)) {
      return answer(401, { error: 'unauthorized' });
    }
    const access: Access = path.startsWith('/v1/sales')
      ? 'sales'
      : path.startsWith('/v1/webhooks')
        ? 'webhooks'
        : 'stats';
    if (state.withheld.has(access)) return answer(403, { error: 'forbidden' });
    // Webhooks need the Ventes access too.
    if (access === 'webhooks' && state.withheld.has('sales')) return answer(403, { error: 'forbidden' });
    const wait = limited(key, path);
    if (wait !== null) {
      void reply.header('retry-after', String(wait));
      return answer(429, { error: 'rate_limited' });
    }
    calls.push({ method, path, status: 200 });
    return undefined;
  });

  const keyOf = (headers: Record<string, unknown>): string => {
    const key = headers['x-api-key'];
    return typeof key === 'string' ? key : '';
  };

  const bad = (reply: FastifyReply, error: string) => reply.code(400).send({ error });
  const forbidden = (reply: FastifyReply) => reply.code(403).send({ error: 'forbidden' });

  // ---- /v1/sales

  const SalesQuery = z.object({
    since: z.string().optional(),
    take: z.coerce.number().int().min(1).max(500).default(100),
    modelId: z.string().optional(),
  });

  app.get('/v1/sales', (request, reply) => {
    const parsed = SalesQuery.safeParse(request.query);
    if (!parsed.success) return bad(reply, 'invalid_query');
    const query = parsed.data;
    if (query.since !== undefined && !/^\d+$/u.test(query.since)) return bad(reply, 'invalid_cursor');
    if (query.modelId !== undefined && !inScope(query.modelId)) return forbidden(reply);
    const since = query.since === undefined ? -1 : Number(query.since);
    const lines = register.filter(
      (line) =>
        Number(line.cursor) > since &&
        inScope(line.sale.modelId) &&
        (query.modelId === undefined || line.sale.modelId === query.modelId),
    );
    const page = lines.slice(0, query.take);
    const hasNextPage = lines.length > query.take;
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

  // ---- /v1/models, /v1/chatters

  app.get('/v1/models', () => ({
    data: models.filter((model) => inScope(model.modelId)).map(wireModel),
  }));

  app.get('/v1/chatters', () => ({
    data: [
      {
        chatterId: 'chatter_test_01',
        firstName: 'Chatteur',
        lastName: 'Test',
        email: 'chatteur@recette.test',
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
      // A manager can sell; a chatting contractor's member has no e-mail; a removed member keeps her past sales.
      {
        chatterId: 'manager_test_01',
        firstName: 'Manager',
        lastName: 'Test',
        email: 'manager@recette.test',
        role: 'manager',
        isBot: false,
        isExternal: false,
        removedAt: null,
        modelIds: ['model_test_01', 'model_test_02'],
      },
      {
        chatterId: 'presta_test_01',
        firstName: 'Prestataire',
        lastName: 'Test',
        email: null,
        role: 'chatter',
        isBot: false,
        isExternal: true,
        removedAt: null,
        modelIds: ['model_test_02'],
      },
      {
        chatterId: 'ancien_test_01',
        firstName: 'Ancien',
        lastName: 'Test',
        email: 'ancien@recette.test',
        role: 'chatter',
        isBot: false,
        isExternal: false,
        removedAt: '2026-10-01T08:00:00.000Z',
        modelIds: [],
      },
    ],
  }));

  // ---- Statistics

  const RangeQuery = z.object({
    from: z.iso.date(),
    to: z.iso.date(),
    modelId: z.string().optional(),
    trackingLinkId: z.string().optional(),
  });

  /** The range asked, checked as Reveal does, or the answer that refuses it. */
  const rangeOf = (query: unknown, reply: FastifyReply) => {
    const parsed = RangeQuery.safeParse(query);
    if (!parsed.success) return { refused: bad(reply, 'invalid_dates') };
    const { from, to, modelId, trackingLinkId } = parsed.data;
    if (from > to) return { refused: bad(reply, 'from_after_to') };
    if (daysBetween(from, to).length > MAX_DAYS) return { refused: bad(reply, 'more_than_31_days') };
    if (modelId !== undefined && !inScope(modelId)) return { refused: forbidden(reply) };
    return { range: { from, to, modelId, trackingLinkId } };
  };

  interface Sum {
    date: string;
    sale: FakeSale;
    count: number;
    ttc: number;
    ht: number;
    agency: number;
    model: number;
    byColumn: Map<string, { count: number; ttc: number; net: number }>;
  }

  /** The register summed per day of each sale (a refund counted against it) and per `key` of its sale. */
  const summed = (
    from: string,
    to: string,
    modelId: string | undefined,
    keyOf: (sale: FakeSale) => string,
  ) => {
    const today = parisDay(now());
    const sums = new Map<string, Sum>();
    for (const line of register) {
      const date = parisDay(line.sale.createdAt);
      if (date < from || date > to || date > today) continue;
      if (!inScope(line.sale.modelId) || (modelId !== undefined && line.sale.modelId !== modelId)) continue;
      const sign = line.event === 'sale_refunded' ? -1 : line.event === 'sale_created' ? 1 : 0;
      if (sign === 0) continue;
      const key = `${date}|${keyOf(line.sale)}`;
      const sum: Sum = sums.get(key) ?? {
        date,
        sale: line.sale,
        count: 0,
        ttc: 0,
        ht: 0,
        agency: 0,
        model: 0,
        byColumn: new Map(),
      };
      const net = line.sale.agencyRevenue + line.sale.modelRevenue;
      const column = COLUMN_OF_TYPE[line.sale.type] ?? 'other';
      const before = sum.byColumn.get(column) ?? { count: 0, ttc: 0, net: 0 };
      sum.byColumn.set(column, {
        count: before.count + sign,
        ttc: before.ttc + sign * line.sale.amountTtc,
        net: before.net + sign * net,
      });
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

  const column = (sum: Sum, name: string) => sum.byColumn.get(name) ?? { count: 0, ttc: 0, net: 0 };
  /** Invented message counts, drawn from the day's sales so that a reading is the same every time. */
  const messages = (sum: Sum) => ({
    sent: 18 * Math.max(sum.count, 0) + 7,
    received: 14 * Math.max(sum.count, 0) + 5,
  });

  const liveDaily = (from: string, to: string, modelId: string | undefined) =>
    summed(from, to, modelId, (sale) => sale.modelId).map((sum) => ({
      date: sum.date,
      modelId: sum.sale.modelId,
      newSubscribers: column(sum, 'subscriptions').count,
      unsubscribes: 0,
      activeSubscribers: models.find((model) => model.modelId === sum.sale.modelId)?.subscribersCount ?? 0,
      revenueTtc: sum.ttc,
      revenueHt: sum.ht,
      agencyRevenue: sum.agency,
      modelRevenue: sum.model,
      ppvSent: state.nightlyDone ? 3 * Math.max(column(sum, 'ppv').count, 0) + 2 : null,
      ppvPurchased: column(sum, 'ppv').count,
      ppvRevenueTtc: column(sum, 'ppv').ttc,
      tipsCount: column(sum, 'tips').count,
      tipsRevenueTtc: column(sum, 'tips').ttc,
      renewals: column(sum, 'renewals').count,
      paymentLinksCount: column(sum, 'paymentLinks').count,
      boudoirCount: column(sum, 'boudoir').count,
      paidMessagesCount: column(sum, 'paidMessages').count,
      subscriptionsNetRevenue: column(sum, 'subscriptions').net,
      renewalsNetRevenue: column(sum, 'renewals').net,
      ppvNetRevenue: column(sum, 'ppv').net,
      tipsNetRevenue: column(sum, 'tips').net,
      paymentLinksNetRevenue: column(sum, 'paymentLinks').net,
      boudoirNetRevenue: column(sum, 'boudoir').net,
      paidMessagesNetRevenue: column(sum, 'paidMessages').net,
      otherNetRevenue: column(sum, 'other').net,
      messagesSent: state.nightlyDone ? messages(sum).sent : null,
      messagesReceived: state.nightlyDone ? messages(sum).received : null,
    }));

  const liveChatters = (from: string, to: string, modelId: string | undefined) =>
    summed(from, to, modelId, (sale) => `${sale.modelId}|${sale.chatterId ?? ''}`).map((sum) => {
      const counted = sum.sale.chatterId !== null && !state.countTimeout;
      return {
        date: sum.date,
        chatterId: sum.sale.chatterId,
        modelId: sum.sale.modelId,
        salesCount: sum.count,
        revenueTtc: sum.ttc,
        revenueHt: sum.ht,
        agencyRevenue: sum.agency,
        modelRevenue: sum.model,
        netRevenue: sum.agency + sum.model,
        ppvPurchased: column(sum, 'ppv').count,
        ppvNetRevenue: column(sum, 'ppv').net,
        tipsCount: column(sum, 'tips').count,
        tipsNetRevenue: column(sum, 'tips').net,
        messagesSent: counted ? messages(sum).sent : null,
        ppvSent: counted ? 3 * Math.max(column(sum, 'ppv').count, 0) + 1 : null,
      };
    });

  const modelsOf = (ids: readonly string[]) =>
    models
      .filter((model) => ids.includes(model.modelId))
      .map((model) => ({ modelId: model.modelId, userName: model.userName, displayName: model.displayName }));

  app.get('/v1/stats/daily', (request, reply) => {
    const asked = rangeOf(request.query, reply);
    if ('refused' in asked) return asked.refused;
    const { from, to, modelId } = asked.range;
    if (state.liveStats) {
      const data = liveDaily(from, to, modelId);
      return {
        from,
        to,
        timezone: 'Europe/Paris',
        currency: 'EUR',
        generatedAt: now().toISOString(),
        models: modelsOf([...new Set(data.map((row) => row.modelId))]),
        data,
      };
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

  app.get('/v1/stats/chatters/daily', (request, reply) => {
    const asked = rangeOf(request.query, reply);
    if ('refused' in asked) return asked.refused;
    const { from, to, modelId } = asked.range;
    if (state.liveStats) {
      const data = liveChatters(from, to, modelId);
      return {
        from,
        to,
        timezone: 'Europe/Paris',
        currency: 'EUR',
        generatedAt: now().toISOString(),
        chatters: [],
        data,
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

  // ---- Tracking links

  const linkDays = (link: FakeTrackingLink, from: string, to: string) => {
    const start = [from, TRACKING_DETAIL_SINCE, parisDay(link.createdAt)].sort().at(-1) ?? from;
    const end = [to, parisDay(now())].sort()[0] ?? to;
    return start > end ? [] : daysBetween(start, end).map((date) => trackingDay(link, date));
  };

  app.get('/v1/tracking-links', (request, reply) => {
    const parsed = z.object({ modelId: z.string().optional() }).safeParse(request.query);
    if (!parsed.success) return bad(reply, 'invalid_query');
    const { modelId } = parsed.data;
    if (modelId !== undefined && !inScope(modelId)) return forbidden(reply);
    const links = TRACKING_LINKS.filter(
      (link) => inScope(link.modelId) && (modelId === undefined || link.modelId === modelId),
    );
    return {
      currency: 'EUR',
      data: links.map((link) => {
        const days = linkDays(link, '2000-01-01', '2999-12-31');
        const total = (pick: (day: (typeof days)[number]) => number) =>
          days.reduce((sum, day) => sum + pick(day), 0);
        const newSubscribers = total((day) => day.newSubscribers);
        const paidSubscribers = total((day) => day.paidSubscribers);
        return {
          trackingLinkId: link.trackingLinkId,
          modelId: link.modelId,
          name: link.name,
          trackingCode: link.trackingCode,
          url: `https://reveal.me/${link.userName}/${link.trackingCode}`,
          createdAt: link.createdAt,
          clicks: link.clicksBefore + total((day) => day.clicks),
          newSubscribers,
          freeSubscribers: newSubscribers - paidSubscribers,
          paidSubscribers,
          revenueTtc: total((day) => day.revenueTtc),
        };
      }),
    };
  });

  app.get('/v1/stats/tracking-links/daily', (request, reply) => {
    const asked = rangeOf(request.query, reply);
    if ('refused' in asked) return asked.refused;
    const { from, to, modelId, trackingLinkId } = asked.range;
    if (trackingLinkId !== undefined) {
      const link = TRACKING_LINKS.find((candidate) => candidate.trackingLinkId === trackingLinkId);
      if (link === undefined || !inScope(link.modelId)) return forbidden(reply);
    }
    const links = TRACKING_LINKS.filter(
      (link) =>
        inScope(link.modelId) &&
        (modelId === undefined || link.modelId === modelId) &&
        (trackingLinkId === undefined || link.trackingLinkId === trackingLinkId),
    );
    return {
      from,
      to,
      timezone: 'Europe/Paris',
      currency: 'EUR',
      generatedAt: now().toISOString(),
      trackingLinks: links.map((link) => ({
        trackingLinkId: link.trackingLinkId,
        modelId: link.modelId,
        name: link.name,
      })),
      data: links.flatMap((link) =>
        linkDays(link, from, to)
          .filter((day) => day.clicks > 0 || day.newSubscribers > 0 || day.revenueTtc > 0)
          .map((day) => ({
            date: day.date,
            trackingLinkId: link.trackingLinkId,
            modelId: link.modelId,
            clicks: day.clicks,
            newSubscribers: day.newSubscribers,
            revenueTtc: day.revenueTtc,
          })),
      ),
    };
  });

  // ---- Webhooks

  const publicWebhook = (webhook: FakeWebhook) => ({
    id: webhook.id,
    url: webhook.url,
    events: webhook.events,
    modelId: webhook.modelId,
    isActive: webhook.isActive,
    createdAt: webhook.createdAt,
  });

  /** The webhook of this id made by this key, `undefined` for one unknown or another key's (404). */
  const ownWebhook = (id: string, key: string) => {
    const webhook = webhooks.get(id);
    return webhook?.key === key ? webhook : undefined;
  };

  const EventsSchema = z.array(z.enum(['sale_created', 'sale_refunded'])).min(1);
  const acceptedUrl = (url: string): boolean =>
    (URL.canParse(url) && new URL(url).protocol === 'https:') ||
    (options.allowLoopbackHttp === true && isLoopbackHttp(url));

  app.post('/v1/webhooks', (request, reply) => {
    const body = z
      .object({ url: z.string(), events: EventsSchema, modelId: z.string().optional() })
      .safeParse(request.body);
    if (!body.success) return bad(reply, 'invalid_body');
    if (!acceptedUrl(body.data.url)) return bad(reply, 'webhook_url_refused');
    const { modelId } = body.data;
    if (modelId === undefined && scope !== null) return bad(reply, 'model_id_required');
    if (modelId !== undefined && !inScope(modelId)) return forbidden(reply);
    if (webhooks.size >= MAX_WEBHOOKS) return forbidden(reply);
    counter += 1;
    const id = `webhook_test_${String(counter)}`;
    const webhook: FakeWebhook = {
      id,
      url: body.data.url,
      events: [...body.data.events],
      modelId: modelId ?? null,
      isActive: true,
      secret: `whsec_test_${String(counter)}`,
      createdAt: now().toISOString(),
      key: keyOf(request.headers),
    };
    webhooks.set(id, webhook);
    return reply.code(201).send({ ...publicWebhook(webhook), secret: webhook.secret });
  });

  app.get('/v1/webhooks', (request) => ({
    data: [...webhooks.values()]
      .filter((webhook) => webhook.key === keyOf(request.headers))
      .map(publicWebhook),
  }));

  app.patch('/v1/webhooks/:id', (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const webhook = ownWebhook(id, keyOf(request.headers));
    if (webhook === undefined) return reply.code(404).send({ error: 'not_found' });
    const body = z
      .object({
        url: z.string().optional(),
        events: EventsSchema.optional(),
        isActive: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!body.success) return bad(reply, 'invalid_body');
    if (body.data.url !== undefined) {
      if (!acceptedUrl(body.data.url)) return bad(reply, 'webhook_url_refused');
      webhook.url = body.data.url;
    }
    if (body.data.events !== undefined) webhook.events = [...body.data.events];
    if (body.data.isActive !== undefined) webhook.isActive = body.data.isActive;
    return publicWebhook(webhook);
  });

  app.delete('/v1/webhooks/:id', (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    if (ownWebhook(id, keyOf(request.headers)) === undefined)
      return reply.code(404).send({ error: 'not_found' });
    webhooks.delete(id);
    // « les supprime avec tout leur historique »
    for (let index = deliveries.length - 1; index >= 0; index -= 1) {
      if (deliveries[index]?.webhookId === id) deliveries.splice(index, 1);
    }
    return reply.code(204).send();
  });

  app.get('/v1/webhooks/:id/deliveries', (request, reply) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    if (ownWebhook(id, keyOf(request.headers)) === undefined)
      return reply.code(404).send({ error: 'not_found' });
    return {
      data: deliveries
        .filter((delivery) => delivery.webhookId === id)
        .slice(-50)
        .reverse()
        .map((delivery) => ({ ...delivery })),
    };
  });

  app.post('/v1/webhooks/:id/deliveries/:deliveryId/retry', (request, reply) => {
    const { id, deliveryId } = z.object({ id: z.string(), deliveryId: z.string() }).parse(request.params);
    const webhook = ownWebhook(id, keyOf(request.headers));
    const delivery = deliveries.find(
      (candidate) => candidate.id === deliveryId && candidate.webhookId === id,
    );
    if (webhook === undefined || delivery === undefined) return reply.code(404).send({ error: 'not_found' });
    if (!webhook.isActive || delivery.status !== 'failed') return reply.code(409).send({ error: 'conflict' });
    delivery.status = 'pending';
    delivery.nextAttemptAt = now().toISOString();
    return reply.code(202).send({ ...delivery });
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not_found' }));

  // ---- Sending the deliveries

  const deliveryBody = (line: RegisterLine, id: string): string =>
    JSON.stringify({ id, event: line.event, createdAt: now().toISOString(), data: wire(line) });

  const signedHeaders = (secret: string, event: string, body: string): Record<string, string> => ({
    'content-type': 'application/json',
    'x-reveal-event': event,
    'x-reveal-signature': revealSignature(secret, Math.floor(now().getTime() / 1000), body),
  });

  const attempt = async (delivery: FakeDelivery): Promise<void> => {
    const webhook = webhooks.get(delivery.webhookId);
    const line = register.find((candidate) => candidate.cursor === delivery.cursor);
    if (webhook === undefined || line === undefined || options.deliver === undefined) return;
    if (!webhook.isActive) {
      delivery.nextAttemptAt = null;
      delivery.status = 'failed';
      return;
    }
    delivery.attempts += 1;
    let status = 0;
    if (state.failures > 0) {
      state.failures -= 1;
    } else {
      const body = deliveryBody(line, delivery.id);
      const headers = signedHeaders(webhook.secret, line.event, body);
      const send = options.deliver;
      const timed = (): Promise<number> =>
        Promise.race([
          send(webhook.url, body, headers),
          new Promise<number>((resolve) =>
            setTimeout(() => {
              resolve(0);
            }, DELIVERY_TIMEOUT_MS).unref(),
          ),
        ]).catch(() => 0);
      status = await timed();
      if (state.duplicates > 0) {
        state.duplicates -= 1;
        await timed();
      }
    }
    delivery.lastStatusCode = status === 0 ? null : status;
    if (status >= 200 && status < 300) {
      delivery.status = 'succeeded';
      delivery.nextAttemptAt = null;
    } else if (delivery.attempts >= DELIVERY_ATTEMPTS) {
      delivery.status = 'failed';
      delivery.nextAttemptAt = null;
    } else {
      delivery.nextAttemptAt = after(RETRY_DELAYS_SECONDS[delivery.attempts - 1] ?? 3600);
    }
  };

  let pumping = false;
  const pumpDeliveries = async (): Promise<void> => {
    if (pumping || options.deliver === undefined) return;
    pumping = true;
    try {
      const at = now().toISOString();
      const due = deliveries.filter(
        (delivery) =>
          delivery.status === 'pending' && delivery.nextAttemptAt !== null && delivery.nextAttemptAt <= at,
      );
      if (state.shuffle) due.reverse();
      for (const delivery of due) await attempt(delivery);
    } finally {
      pumping = false;
    }
  };

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
    setModels(next) {
      models = next;
    },
    rateLimit(requests, retryAfterSeconds) {
      state.rateLimited = requests;
      state.retryAfterSeconds = retryAfterSeconds;
    },
    revoke() {
      state.revoked = true;
    },
    restore() {
      state.revoked = false;
      state.withheld.clear();
      scope = null;
      state.rateLimited = 0;
      windows.clear();
    },
    withhold(access) {
      state.withheld.add(access);
    },
    limitTo(modelIds) {
      scope = modelIds === null ? null : [...modelIds];
    },
    setNightlyDone(done) {
      state.nightlyDone = done;
    },
    setCountTimeout(on) {
      state.countTimeout = on;
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
    deliveries,
    setWebhookOutage(on) {
      state.outage = on;
    },
    duplicateNext(count) {
      state.duplicates = count;
    },
    failNext(count) {
      state.failures = count;
    },
    setShuffle(on) {
      state.shuffle = on;
    },
    pumpDeliveries,
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
          'x-reveal-event': line.event,
          'x-reveal-signature': revealSignature(secret, t, body),
        },
      };
    },
  };
}
