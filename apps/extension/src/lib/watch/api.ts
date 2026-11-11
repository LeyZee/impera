import {
  ExtensionLinkCreatorsSchema,
  ExtensionLinkTokenSchema,
  TrendCapturesDescribedSchema,
  TrendReadingsAcceptedSchema,
  TrendReadingsBatchSchema,
  TrendCapturesBodySchema,
  ApiErrorSchema,
  TREND_WATCH_BUDGET_LIMITED,
  TREND_CAPTURE_VISION_UNAVAILABLE,
  type ExtensionLinkCreators,
  type TrendCapturesBody,
  type TrendReadingsBatch,
} from '@impera/contracts';

/**
 * The watch's three doors on the API (VEI-01 lot b and c2), called by the service worker only, with the person's link
 * in `x-extension-link`, never the CRM's cookie (ADR 0066 § 7). What she watched is sent, never logged here.
 */

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 15_000;
const CAPTURES_TIMEOUT_MS = 60_000;

/** `revoked`: the link was removed in the CRM (401); `unreachable`: no answer, or the server is down, try later. */
export type Sent<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'revoked' }
  | { readonly kind: 'refused'; readonly code: string | null }
  | { readonly kind: 'unreachable' };

export async function call<T>(
  fetchFn: Fetch,
  url: string,
  token: string,
  init: { method: 'GET' | 'POST'; body?: unknown; timeoutMs?: number },
  parse: (body: unknown) => T | null,
): Promise<Sent<T>> {
  const link = ExtensionLinkTokenSchema.safeParse(token);
  if (!link.success) return { kind: 'revoked' };
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: init.method,
      // The CRM's cookie never goes with a reading: the link alone says who sends.
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'x-extension-link': link.data,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    });
  } catch {
    return { kind: 'unreachable' };
  }
  if (response.status === 401) return { kind: 'revoked' };
  if (response.status >= 500 || response.status === 429 || response.status === 408) {
    const code = await errorCodeOf(response);
    // The trend watch's cap and a missing vision model are answers, not outages.
    if (code === TREND_WATCH_BUDGET_LIMITED || code === TREND_CAPTURE_VISION_UNAVAILABLE)
      return { kind: 'refused', code };
    return { kind: 'unreachable' };
  }
  if (!response.ok) return { kind: 'refused', code: await errorCodeOf(response) };
  const value = parse(await response.json().catch(() => null));
  return value === null ? { kind: 'unreachable' } : { kind: 'ok', value };
}

async function errorCodeOf(response: Response): Promise<string | null> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.code : null;
}

export function fetchMarkableCreators(
  origin: string,
  token: string,
  fetchFn: Fetch = fetch,
): Promise<Sent<ExtensionLinkCreators>> {
  return call(fetchFn, `${origin}/v1/trends/readings/creators`, token, { method: 'GET' }, (body) => {
    const parsed = ExtensionLinkCreatorsSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  });
}

export function sendReadings(
  origin: string,
  token: string,
  batch: TrendReadingsBatch,
  fetchFn: Fetch = fetch,
): Promise<Sent<number>> {
  return call(
    fetchFn,
    `${origin}/v1/trends/readings`,
    token,
    { method: 'POST', body: TrendReadingsBatchSchema.parse(batch) },
    (body) => {
      const parsed = TrendReadingsAcceptedSchema.safeParse(body);
      return parsed.success ? parsed.data.accepted : null;
    },
  );
}

export type Described = 'described' | 'budget' | 'unavailable' | 'failed' | 'revoked';

/** Sends the captures of a marked post for the vision; they are dropped here once sent, whatever the answer. */
export async function sendCaptures(
  origin: string,
  token: string,
  body: TrendCapturesBody,
  fetchFn: Fetch = fetch,
): Promise<Described> {
  const sent = await call(
    fetchFn,
    `${origin}/v1/trends/readings/captures`,
    token,
    { method: 'POST', body: TrendCapturesBodySchema.parse(body), timeoutMs: CAPTURES_TIMEOUT_MS },
    (answer) => (TrendCapturesDescribedSchema.safeParse(answer).success ? true : null),
  );
  switch (sent.kind) {
    case 'ok':
      return 'described';
    case 'revoked':
      return 'revoked';
    case 'unreachable':
      return 'failed';
    case 'refused':
      if (sent.code === TREND_WATCH_BUDGET_LIMITED) return 'budget';
      if (sent.code === TREND_CAPTURE_VISION_UNAVAILABLE) return 'unavailable';
      // No marked reading of that post yet, or any other refusal: the reading stays, without its description.
      return 'failed';
  }
}
