import {
  CurrencySchema,
  SaleAmountsSchema,
  SaleStatusSchema,
  SaleTypeSchema,
  type PlatformModelStatus,
  type PlatformSale,
  type SaleEvent,
  type SaleStatus,
  type SaleType,
  type SalesFeedCapability,
} from '@impera/contracts';
import { z } from 'zod';

import { SALES_FEED_TIME_ZONES } from '../../domain/sale-days';
import type {
  DateRange,
  PlatformSalesFeed,
  SalesFeedFailure,
  SalesFeedResult,
  UnknownValue,
} from '../../domain/sales-feed';

import {
  RevealChatterDailyStatsSchema,
  RevealCreatedWebhookSchema,
  RevealChattersSchema,
  RevealDailyStatsSchema,
  RevealModelsSchema,
  RevealSalesPageSchema,
} from './wire';

/** Reveal's CRM API (ADR 0050): `x-api-key`, an agency key, used on the server only. */
const REVEAL_CRM_BASE_URL = 'https://api.reveal.me';

/** The zone Reveal counts its statistics' days in; an answer in another one is not read. */
const REVEAL_TIME_ZONE = SALES_FEED_TIME_ZONES.reveal;
/** The most `/v1/sales` gives in one page. */
const PAGE_SIZE = 500;
const CALL_TIMEOUT_MS = 15_000;
/** A 429 without a readable `Retry-After`: one minute, the job's own pace. */
const DEFAULT_RETRY_AFTER_MS = 60_000;

/** `fetch`, narrowed to what the adapter uses, so a test can hand FakeReveal over. */
export type SalesFeedFetch = (
  url: string,
  init: {
    readonly method?: 'GET' | 'POST' | 'DELETE';
    readonly headers: Record<string, string>;
    readonly body?: string;
    readonly signal: AbortSignal;
  },
) => Promise<{
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface RevealSalesFeedOptions {
  readonly key: string;
  readonly fetch: SalesFeedFetch;
  readonly baseUrl?: string;
  readonly now?: () => Date;
}

/**
 * Reveal's agency keys start with `rvl_` (its documentation; the rest of the shape is not given): a paste that does
 * not, or holds a space, is refused before any call.
 */
export function isPlausibleRevealKey(key: string): boolean {
  return key.startsWith('rvl_') && key.length >= 12 && !/\s/.test(key);
}

const EVENTS: Readonly<Record<string, SaleEvent>> = { sale_created: 'sale', sale_refunded: 'refund' };

/** `Retry-After` in seconds or as an HTTP date. */
function retryAfterMs(header: string | null, now: Date): number {
  if (header === null) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? DEFAULT_RETRY_AFTER_MS : Math.max(0, at - now.getTime());
}

/** Reveal's model statuses (camelCase) in the contract's words; any other value reads as `other`. */
const MODEL_STATUSES: ReadonlyMap<string, PlatformModelStatus> = new Map([
  ['validated', 'validated'],
  ['pending', 'pending'],
  ['onboardingChangesRequested', 'onboarding_changes_requested'],
  ['refused', 'refused'],
  ['banned', 'banned'],
]);

/** A photo address kept only when it is a valid `https` URL; anything else reads as no photo. */
function httpsUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return HttpsUrlSchema.safeParse(value).success ? value : null;
}
const HttpsUrlSchema = z.url({ protocol: /^https$/ });

/** A value Reveal says may grow: known, or `other` with its raw value kept and signalled. */
function mapped<T extends string>(
  schema: z.ZodType<T>,
  value: string,
  field: UnknownValue['field'],
  unknown: UnknownValue[],
): { value: T | 'other'; raw: string | null } {
  const parsed = schema.safeParse(value);
  if (parsed.success && parsed.data !== 'other') return { value: parsed.data, raw: null };
  unknown.push({ field, value });
  return { value: 'other', raw: value };
}

export function createRevealSalesFeed(options: RevealSalesFeedOptions): PlatformSalesFeed {
  const base = (options.baseUrl ?? REVEAL_CRM_BASE_URL).replace(/\/$/, '');
  const now = options.now ?? (() => new Date());

  async function call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    query: Record<string, string | undefined>,
    payload?: object,
  ): Promise<SalesFeedResult<{ readonly status: number; readonly body: string }>> {
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) if (value !== undefined) search.set(name, value);
    const url = `${base}${path}${search.size === 0 ? '' : `?${search.toString()}`}`;
    try {
      const response = await options.fetch(url, {
        method,
        headers: {
          'x-api-key': options.key,
          accept: 'application/json',
          ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      const body = await response.text();
      const failure = failureOf(response.status, response.headers.get('retry-after'));
      if (failure !== null) return { ok: false, failure };
      return { ok: true, value: { status: response.status, body } };
    } catch {
      return { ok: false, failure: { kind: 'unreachable' } };
    }
  }

  async function get<S extends z.ZodType>(
    path: string,
    query: Record<string, string | undefined>,
    schema: S,
    method: 'GET' | 'POST' = 'GET',
    payload?: object,
  ): Promise<SalesFeedResult<z.output<S>>> {
    const answer = await call(method, path, query, payload);
    if (!answer.ok) return answer;
    const body = answer.value.body;
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return { ok: false, failure: { kind: 'unexpected_answer', detail: `${path}: not JSON` } };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // The path of each issue only: never a value, which may be a fan's.
      const where = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
      return { ok: false, failure: { kind: 'unexpected_answer', detail: `${path}: ${where}` } };
    }
    return { ok: true, value: parsed.data };
  }

  function failureOf(status: number, retryAfter: string | null): SalesFeedFailure | null {
    if (status >= 200 && status < 300) return null;
    if (status === 401) return { kind: 'refused', errorKind: 'unauthorized' };
    if (status === 403) return { kind: 'refused', errorKind: 'missing_access' };
    if (status === 429) return { kind: 'rate_limited', retryAfterMs: retryAfterMs(retryAfter, now()) };
    if (status >= 500 || status === 408) return { kind: 'unreachable' };
    return { kind: 'unexpected_answer', detail: `HTTP ${String(status)}` };
  }

  return {
    platform: 'reveal',
    capabilities: ['sales', 'stats', 'team'],
    timeZone: REVEAL_TIME_ZONE,

    async verify() {
      // ADR 0050 § 4: `/v1/models` for the Statistiques access, `/v1/sales` for the Ventes access; both are needed.
      const models = await get('/v1/models', {}, RevealModelsSchema);
      if (!models.ok) return models;
      const sales = await get('/v1/sales', { take: '1' }, RevealSalesPageSchema);
      if (!sales.ok) return sales;
      const opened: readonly SalesFeedCapability[] = ['sales', 'stats', 'team'];
      return { ok: true, value: opened };
    },

    async readSales(position) {
      const page = await get(
        '/v1/sales',
        { since: position ?? undefined, take: String(PAGE_SIZE) },
        RevealSalesPageSchema,
      );
      if (!page.ok) return page;
      const currency = CurrencySchema.safeParse(page.value.currency);
      if (!currency.success) {
        return { ok: false, failure: { kind: 'unexpected_answer', detail: '/v1/sales: currency' } };
      }
      const unknown: UnknownValue[] = [];
      const sales: PlatformSale[] = [];
      for (const line of page.value.data) {
        const event = EVENTS[line.event];
        if (event === undefined) {
          // Nothing to record it as: skipped and signalled, the cursor moves past it like any line.
          unknown.push({ field: 'event', value: line.event });
          continue;
        }
        const { sale } = line;
        const amounts = SaleAmountsSchema.safeParse({
          grossInclVat: sale.amountTtc,
          grossExclVat: sale.amountHt,
          net: sale.netAmount,
          agency: sale.agencyRevenue,
          creator: sale.modelRevenue,
        });
        if (!amounts.success) {
          // Amounts that do not add up (net ≠ agency + model) or out of order (net ≤ HT ≤ TTC): no line of this page is
          // recorded, the cursor stays. The detail names the rule, never a value.
          return {
            ok: false,
            failure: {
              kind: 'unexpected_answer',
              detail: `/v1/sales: ${amounts.error.issues[0]?.message ?? 'amounts'}`,
            },
          };
        }
        const type = mapped<SaleType>(SaleTypeSchema, sale.type, 'type', unknown);
        const status = mapped<SaleStatus>(SaleStatusSchema, sale.status, 'status', unknown);
        sales.push({
          position: line.cursor,
          platformSaleId: sale.id,
          event,
          type: type.value,
          rawType: type.raw,
          status: status.value,
          rawStatus: status.raw,
          occurredAt: new Date(line.occurredAt).toISOString(),
          platformModelId: sale.modelId,
          platformChatterId: sale.chatterId,
          platformFanId: sale.fan?.memberId ?? null,
          currency: currency.data,
          amounts: amounts.data,
        });
      }
      const last = page.value.data.at(-1);
      return {
        ok: true,
        value: {
          sales,
          endPosition: page.value.pageInfo.endCursor ?? last?.cursor ?? position,
          hasMore: page.value.pageInfo.hasNextPage,
          unknown,
        },
      };
    },

    async listModels() {
      const models = await get('/v1/models', {}, RevealModelsSchema);
      if (!models.ok) return models;
      return {
        ok: true,
        value: models.value.data.map((model) => ({
          platformModelId: model.modelId,
          handle: model.userName,
          displayName: model.displayName,
          isActive: model.isActive,
          status: MODEL_STATUSES.get(model.status) ?? 'other',
          rawStatus: model.status,
          avatarUrl: httpsUrl(model.avatarUrl),
        })),
      };
    },

    async listChatters() {
      const chatters = await get('/v1/chatters', {}, RevealChattersSchema);
      if (!chatters.ok) return chatters;
      return {
        ok: true,
        value: chatters.value.data.map((chatter) => ({
          platformChatterId: chatter.chatterId,
          firstName: chatter.firstName,
          lastName: chatter.lastName,
          email: chatter.email ?? null,
          role: chatter.role ?? '',
          isBot: chatter.isBot,
          isExternal: chatter.isExternal,
          removedAt: chatter.removedAt === null ? null : new Date(chatter.removedAt).toISOString(),
          platformModelIds: chatter.modelIds,
        })),
      };
    },

    async dailyStats(range: DateRange) {
      const stats = await get('/v1/stats/daily', { from: range.from, to: range.to }, RevealDailyStatsSchema);
      if (!stats.ok) return stats;
      if (stats.value.timezone !== undefined && stats.value.timezone !== REVEAL_TIME_ZONE) {
        return { ok: false, failure: { kind: 'unexpected_answer', detail: '/v1/stats/daily: timezone' } };
      }
      return {
        ok: true,
        value: stats.value.data.map((row) => ({
          date: row.date,
          platformModelId: row.modelId,
          newSubscribers: row.newSubscribers,
          unsubscribes: row.unsubscribes ?? null,
          activeSubscribers: row.activeSubscribers,
          renewals: row.renewals ?? null,
          revenueInclVat: row.revenueTtc,
          revenueExclVat: row.revenueHt,
          agency: row.agencyRevenue,
          creator: row.modelRevenue,
          ppvPurchased: row.ppvPurchased,
          ppvSent: row.ppvSent,
          messagesSent: row.messagesSent,
          messagesReceived: row.messagesReceived,
        })),
      };
    },

    async chatterDailyStats(range: DateRange) {
      const stats = await get(
        '/v1/stats/chatters/daily',
        { from: range.from, to: range.to },
        RevealChatterDailyStatsSchema,
      );
      if (!stats.ok) return stats;
      if (stats.value.timezone !== undefined && stats.value.timezone !== REVEAL_TIME_ZONE) {
        return {
          ok: false,
          failure: { kind: 'unexpected_answer', detail: '/v1/stats/chatters/daily: timezone' },
        };
      }
      for (const row of stats.value.data) {
        if (row.netRevenue !== row.agencyRevenue + row.modelRevenue) {
          return {
            ok: false,
            failure: { kind: 'unexpected_answer', detail: '/v1/stats/chatters/daily: net ≠ agency + model' },
          };
        }
      }
      return {
        ok: true,
        value: stats.value.data.map((row) => ({
          date: row.date,
          platformChatterId: row.chatterId,
          platformModelId: row.modelId,
          salesCount: row.salesCount,
          revenueInclVat: row.revenueTtc,
          agency: row.agencyRevenue,
          creator: row.modelRevenue,
          ppvPurchased: row.ppvPurchased,
          ppvSent: row.ppvSent,
          messagesSent: row.messagesSent,
        })),
      };
    },

    async createWebhook(url) {
      const created = await get('/v1/webhooks', {}, RevealCreatedWebhookSchema, 'POST', {
        url,
        events: ['sale_created', 'sale_refunded'],
      });
      if (!created.ok) return created;
      const webhook = 'data' in created.value ? created.value.data : created.value;
      return { ok: true, value: { platformWebhookId: webhook.id, secret: webhook.secret } };
    },

    async deleteWebhook(platformWebhookId) {
      const removed = await call('DELETE', `/v1/webhooks/${encodeURIComponent(platformWebhookId)}`, {});
      // Already gone at Reveal (404, the documentation's « webhook inconnu »): what was asked is true.
      if (
        !removed.ok &&
        removed.failure.kind === 'unexpected_answer' &&
        removed.failure.detail === 'HTTP 404'
      ) {
        return { ok: true, value: null };
      }
      return removed.ok ? { ok: true, value: null } : removed;
    },
  };
}
