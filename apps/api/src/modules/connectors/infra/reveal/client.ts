import type { z } from 'zod';

import { ConnectorError } from '../../domain/platform-connector';

import { REVEAL_ENDPOINTS, type RevealEndpointName } from './wire';

/** Reveal's private API (reveal-connector-spec.md § 3); FakeReveal's address in the tests. */
export const REVEAL_API_BASE_URL = 'https://api.reveal.me';
/** The dashboard the captured session comes from: its origin is sent as the official client sends it. */
const DASHBOARD_ORIGIN = 'https://dashboard.reveal.me';
const CALL_TIMEOUT_MS = 15_000;
/** A 429 without a readable `Retry-After`: one minute. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;
/** Below this share of a window left, the next call waits for the window's reset (spec § 3). */
const LOW_REMAINING_SHARE = 0.2;
const RATE_WINDOWS = ['short', 'medium', 'long'] as const;
/** The send window lasts a minute: a reset further away is a clock gone wrong, never a reason to wait longer. */
const SEND_WINDOW_MS = 60_000;

/** `fetch`, narrowed to what the client uses (undici's, Node's own), so a test can hand FakeReveal over. */
export type RevealFetch = (
  url: string,
  init: {
    readonly method: 'GET' | 'POST' | 'PATCH';
    readonly headers: Record<string, string>;
    readonly signal: AbortSignal;
    /** JSON, on a write only. */
    readonly body?: string;
  },
) => Promise<{
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/**
 * What the client logs of one call: the route's name (a template, never an identifier), the status and the duration.
 * Never the token, a URL or a body (spec § 3).
 */
export interface RevealCallLog {
  readonly route: RevealEndpointName;
  /** `null` when no answer came (network, timeout). */
  readonly status: number | null;
  readonly ms: number;
}

export interface RevealClientOptions {
  readonly baseUrl: string;
  readonly bearer: string;
  readonly userAgent: string;
  readonly fetch: RevealFetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (entry: RevealCallLog) => void;
}

type ReadEndpoint = {
  [N in RevealEndpointName]: (typeof REVEAL_ENDPOINTS)[N]['method'] extends 'GET' ? N : never;
}[RevealEndpointName];

type WriteEndpoint = Exclude<RevealEndpointName, ReadEndpoint>;

export interface RevealClient {
  /**
   * One read of `route`, whose answer must pass `shape` (the route's own, from `REVEAL_ENDPOINTS`): `id` fills the
   * route's `:id`; `query` keeps its order and may repeat a name (`status[]`).
   */
  get<S extends z.ZodType>(
    route: ReadEndpoint,
    shape: S,
    id: string,
    query?: readonly (readonly [string, string])[],
  ): Promise<z.output<S>>;
  /**
   * One write of `route` (its method from `REVEAL_ENDPOINTS`), with `body` as JSON when given. No retry here: a write
   * whose answer is lost is checked by its caller (`verifySent`), never sent again blind.
   */
  write<S extends z.ZodType>(route: WriteEndpoint, shape: S, id: string, body?: object): Promise<z.output<S>>;
}

function retryAfterSeconds(header: string | null): number {
  const seconds = header === null ? Number.NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : DEFAULT_RETRY_AFTER_SECONDS;
}

/**
 * The longest reset among the windows that fell under 20 % left; 0 when none did. The three windows of every answer
 * give their reset in seconds from now; the send window (`x-ratelimit-*`, on `POST …/messages` only, 60 a minute)
 * gives it as an epoch second (headers.md).
 */
function waitAfter(headers: { get(name: string): string | null }, nowMs: number): number {
  let waitMs = 0;
  for (const window of RATE_WINDOWS) {
    const limit = Number(headers.get(`x-ratelimit-limit-${window}`));
    const remaining = Number(headers.get(`x-ratelimit-remaining-${window}`));
    const reset = Number(headers.get(`x-ratelimit-reset-${window}`));
    if (!(limit > 0) || !Number.isFinite(remaining) || !(reset >= 0)) continue;
    if (remaining < limit * LOW_REMAINING_SHARE) waitMs = Math.max(waitMs, reset * 1_000);
  }
  const limit = Number(headers.get('x-ratelimit-limit'));
  const remaining = Number(headers.get('x-ratelimit-remaining'));
  const resetAt = Number(headers.get('x-ratelimit-reset'));
  if (limit > 0 && Number.isFinite(remaining) && resetAt > 0 && remaining < limit * LOW_REMAINING_SHARE) {
    waitMs = Math.max(waitMs, Math.min(resetAt * 1_000 - nowMs, SEND_WINDOW_MS));
  }
  return waitMs;
}

/** The error of a non-2xx answer (spec § 3). A 403 that is a page, not JSON, is an anti-bot challenge (§ 7). */
function failureOf(
  route: RevealEndpointName,
  status: number,
  contentType: string | null,
  retryAfter: string | null,
) {
  if (status === 401) return new ConnectorError('session_expired', `${route}: session refused`);
  if (status === 403) {
    return contentType?.includes('text/html') === true
      ? new ConnectorError('fatal', `challenge: ${route} answered a page instead of JSON`)
      : new ConnectorError('session_expired', `${route}: session refused`);
  }
  if (status === 404) return new ConnectorError('not_found', `${route}: not found`);
  if (status === 429) {
    return new ConnectorError('rate_limited', `${route}: rate limited`, {
      retryAfterSeconds: retryAfterSeconds(retryAfter),
    });
  }
  if (status >= 500 || status === 408)
    return new ConnectorError('transient', `${route}: HTTP ${String(status)}`);
  return new ConnectorError('fatal', `${route}: HTTP ${String(status)}`);
}

function parseAnswer<S extends z.ZodType>(route: RevealEndpointName, shape: S, body: string): z.output<S> {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ConnectorError('fatal', `shape_changed: ${route} (not JSON)`);
  }
  const parsed = shape.safeParse(json);
  if (!parsed.success) {
    // The path of each issue only: never a value, which may be a fan's.
    const where = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(root)'))];
    throw new ConnectorError('fatal', `shape_changed: ${route} (${where.slice(0, 5).join(', ')})`);
  }
  return parsed.data;
}

/**
 * The HTTP client of one account (spec § 3): the session's bearer and user agent, the dashboard's origin, nothing
 * else. It slows down before a rate window runs out, and turns every failure into a `ConnectorError`. An answer that
 * does not pass its shape is `fatal` « shape_changed », naming the route and the Zod paths, never a value.
 */
export function createRevealClient(options: RevealClientOptions): RevealClient {
  const base = options.baseUrl.replace(/\/+$/u, '');
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.bearer}`,
    'user-agent': options.userAgent,
    origin: DASHBOARD_ORIGIN,
    referer: `${DASHBOARD_ORIGIN}/`,
  };
  let notBefore = 0;

  async function call<S extends z.ZodType>(
    route: RevealEndpointName,
    shape: S,
    id: string,
    query: readonly (readonly [string, string])[],
    body: object | undefined,
  ): Promise<z.output<S>> {
    const search = new URLSearchParams();
    for (const [name, value] of query) search.append(name, value);
    const endpoint = REVEAL_ENDPOINTS[route];
    const path = endpoint.path.replace(':id', encodeURIComponent(id));
    const url = `${base}${path}${search.size === 0 ? '' : `?${search.toString()}`}`;

    const wait = notBefore - options.now();
    if (wait > 0) await options.sleep(wait);
    const started = options.now();
    let response: Awaited<ReturnType<RevealFetch>>;
    let text: string;
    try {
      response = await options.fetch(url, {
        method: endpoint.method,
        headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      text = await response.text();
    } catch {
      // The cause is left out on purpose: a network error may quote the request.
      options.log({ route, status: null, ms: options.now() - started });
      throw new ConnectorError('transient', `${route}: unreachable`);
    }
    options.log({ route, status: response.status, ms: options.now() - started });
    const pause = waitAfter(response.headers, options.now());
    if (pause > 0) notBefore = Math.max(notBefore, options.now() + pause);

    if (response.status < 200 || response.status >= 300) {
      throw failureOf(
        route,
        response.status,
        response.headers.get('content-type'),
        response.headers.get('retry-after'),
      );
    }
    return parseAnswer(route, shape, text);
  }

  return {
    get: (route, shape, id, query = []) => call(route, shape, id, query, undefined),
    write: (route, shape, id, body) => call(route, shape, id, [], body),
  };
}
