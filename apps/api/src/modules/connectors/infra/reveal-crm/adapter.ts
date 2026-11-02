import {
  CurrencySchema,
  SaleAmountsSchema,
  SaleStatusSchema,
  SaleTypeSchema,
  type PlatformSale,
  type SaleEvent,
  type SaleStatus,
  type SaleType,
  type SalesFeedCapability,
} from '@nirvana/contracts';
import type { z } from 'zod';

import type {
  DateRange,
  PlatformSalesFeed,
  SalesFeedFailure,
  SalesFeedResult,
  UnknownValue,
} from '../../domain/sales-feed';

import {
  RevealChatterDailyStatsSchema,
  RevealChattersSchema,
  RevealDailyStatsSchema,
  RevealModelsSchema,
  RevealSalesPageSchema,
} from './wire';

/** Reveal's CRM API (ADR 0050): `x-api-key`, an agency key, used on the server only. */
export const REVEAL_CRM_BASE_URL = 'https://api.reveal.me';

/** The most `/v1/sales` gives in one page. */
const PAGE_SIZE = 500;
const CALL_TIMEOUT_MS = 15_000;
/** A 429 without a readable `Retry-After`: one minute, the job's own pace. */
const DEFAULT_RETRY_AFTER_MS = 60_000;

/** `fetch`, narrowed to what the adapter uses, so a test can hand FakeReveal over. */
export type SalesFeedFetch = (
  url: string,
  init: { readonly headers: Record<string, string>; readonly signal: AbortSignal },
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

  async function get<S extends z.ZodType>(
    path: string,
    query: Record<string, string | undefined>,
    schema: S,
  ): Promise<SalesFeedResult<z.output<S>>> {
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) if (value !== undefined) search.set(name, value);
    const url = `${base}${path}${search.size === 0 ? '' : `?${search.toString()}`}`;
    let response: Awaited<ReturnType<SalesFeedFetch>>;
    let body: string;
    try {
      response = await options.fetch(url, {
        headers: { 'x-api-key': options.key, accept: 'application/json' },
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      body = await response.text();
    } catch {
      return { ok: false, failure: { kind: 'unreachable' } };
    }
    const failure = failureOf(response.status, response.headers.get('retry-after'));
    if (failure !== null) return { ok: false, failure };
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
          // netAmount ≠ agencyRevenue + modelRevenue: no line of this page is recorded, the cursor stays.
          return {
            ok: false,
            failure: { kind: 'unexpected_answer', detail: '/v1/sales: netAmount ≠ agency + model' },
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
      return {
        ok: true,
        value: stats.value.data.map((row) => ({
          date: row.date,
          platformModelId: row.modelId,
          newSubscribers: row.newSubscribers,
          activeSubscribers: row.activeSubscribers,
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
  };
}
