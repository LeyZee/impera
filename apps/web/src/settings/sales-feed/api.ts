import {
  ApiErrorSchema,
  REAUTHENTICATION_ERROR_CODE,
  SalesFeedErrorCodeSchema,
  SalesFeedListSchema,
  SalesFeedOverviewSchema,
  SalesFeedRefusalSchema,
  SalesFeedStatusSchema,
  type LinkSalesFeedChatterBody,
  type Platform,
  type SalesFeedOverview,
  type SalesFeedRefusal,
  type SalesFeedStatus,
} from '@nirvana/contracts';

import { ReauthRequired, ServicesError } from '@/settings/services/api';

/**
 * `/v1/settings/sales-feeds` (CRM-01, ADR 0050 § 4). The key goes up once, in the body of `PUT …/key`; no answer ever
 * brings it back, even masked. Every answer is parsed with the contract: a shape the page does not expect is an
 * error, not a guess. The failures read as the Services page reads them (`ServicesError`, `ReauthRequired`), so
 * both pages say the same sentence for the same thing.
 */

const BASE = '/v1/settings/sales-feeds';
const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * A refusal the server words itself (`sales_feed_*`: a model already linked elsewhere, no HTTPS address, the vault
 * missing…): its French sentence is the one to show, as it is.
 */
export class SalesFeedRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesFeedRefused';
  }
}

async function apiError(response: Response): Promise<{ code: string; message: string } | null> {
  const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return body.success ? { code: body.data.error.code, message: body.data.error.message } : null;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const what = `${init.method ?? 'GET'} ${path}`;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { credentials: 'include', ...init });
  } catch {
    throw new ServicesError('unavailable', `${what}: réseau`);
  }
  if (response.ok) return response;
  const detail = `${what}: ${String(response.status)}`;
  if (response.status === 401) throw new ServicesError('session_expired', detail);
  if (response.status === 429) throw new ServicesError('rate_limited', detail);
  // A 422 is either the platform's refusal of the key or webhook (its own shape, read by the caller) or a refusal
  // of ours: told apart by the body, read on a copy.
  if (response.status === 422) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (SalesFeedRefusalSchema.safeParse(body).success) return response;
    const error = ApiErrorSchema.safeParse(body);
    if (error.success && SalesFeedErrorCodeSchema.safeParse(error.data.error.code).success) {
      throw new SalesFeedRefused(error.data.error.message);
    }
    throw new ServicesError('unavailable', detail);
  }
  const error = await apiError(response);
  if (response.status === 403) {
    if (error?.code === REAUTHENTICATION_ERROR_CODE) throw new ReauthRequired();
    if (error?.code === 'role_forbidden') throw new ServicesError('forbidden', detail);
  }
  if (error !== null && SalesFeedErrorCodeSchema.safeParse(error.code).success) {
    throw new SalesFeedRefused(error.message);
  }
  throw new ServicesError('unavailable', detail);
}

/** An answer the contract refuses reads as « Le serveur ne répond pas », like any answer the page cannot use. */
async function parsed<T>(response: Response, parse: (body: unknown) => T): Promise<T> {
  try {
    return parse(await response.json());
  } catch {
    throw new ServicesError('unavailable', `réponse inattendue (${String(response.status)})`);
  }
}

/** The feeds the server knows, one line each (Reveal's CRM API alone for now). */
export async function fetchFeeds(): Promise<SalesFeedStatus[]> {
  return parsed(await call(''), (body) => SalesFeedListSchema.parse(body).feeds);
}

export async function fetchOverview(platform: Platform): Promise<SalesFeedOverview> {
  return parsed(await call(`/${platform}`), (body) => SalesFeedOverviewSchema.parse(body));
}

export type FeedResult = { ok: true; status: SalesFeedStatus } | { ok: false; refusal: SalesFeedRefusal };

async function statusOrRefusal(response: Response): Promise<FeedResult> {
  return parsed(response, (body): FeedResult =>
    response.status === 422
      ? { ok: false, refusal: SalesFeedRefusalSchema.parse(body) }
      : { ok: true, status: SalesFeedStatusSchema.parse(body) },
  );
}

/** Checked at the platform before it is kept (ADR 0050 § 4): a key it refuses comes back as a refusal, never saved. */
export async function connectKey(platform: Platform, key: string): Promise<FeedResult> {
  return statusOrRefusal(
    await call(`/${platform}/key`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ key }) }),
  );
}

/** Removes the key, and the webhook with it (the server takes the webhook off first). */
export async function disconnect(platform: Platform): Promise<SalesFeedStatus> {
  return parsed(await call(`/${platform}`, { method: 'DELETE' }), (body) =>
    SalesFeedStatusSchema.parse(body),
  );
}

/**
 * Registers the webhook at the platform, or registers it again (a new secret; the old one is taken off after). No
 * body, so no JSON content type: Fastify refuses an empty body announced as JSON.
 */
export async function connectWebhook(platform: Platform): Promise<FeedResult> {
  return statusOrRefusal(await call(`/${platform}/webhook`, { method: 'PUT' }));
}

export async function disconnectWebhook(platform: Platform): Promise<SalesFeedStatus> {
  return parsed(await call(`/${platform}/webhook`, { method: 'DELETE' }), (body) =>
    SalesFeedStatusSchema.parse(body),
  );
}

/** `null` unlinks: the model's next sales wait in quarantine again. */
export async function linkModel(
  platform: Platform,
  platformModelId: string,
  platformAccountId: string | null,
): Promise<SalesFeedOverview> {
  const response = await call(`/${platform}/models/${encodeURIComponent(platformModelId)}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ platformAccountId }),
  });
  return parsed(response, (body) => SalesFeedOverviewSchema.parse(body));
}

export async function linkChatter(
  platform: Platform,
  platformChatterId: string,
  link: LinkSalesFeedChatterBody,
): Promise<SalesFeedOverview> {
  const response = await call(`/${platform}/chatters/${encodeURIComponent(platformChatterId)}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(link),
  });
  return parsed(response, (body) => SalesFeedOverviewSchema.parse(body));
}
