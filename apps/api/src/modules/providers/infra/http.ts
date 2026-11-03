import type { RefusedKey } from '../domain/verification';

/**
 * One read-only GET for a verifier. No retry: verification is driven by Charles pasting a key or by the 15-minute
 * job, and an unreachable provider is reported as such (`unreachable`) without touching the saved key.
 */
const VERIFY_TIMEOUT_MS = 10_000;

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{
  readonly status: number;
  text(): Promise<string>;
}>;

export type HttpReply =
  | { readonly kind: 'reply'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'unreachable' };

export async function getJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  timeoutMs = VERIFY_TIMEOUT_MS,
): Promise<HttpReply> {
  try {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    return { kind: 'reply', status: response.status, body: parseBody(text) };
  } catch {
    return { kind: 'unreachable' };
  }
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Server-side trouble, a timeout or a rate limit says nothing about the key: a 429 during the 15-minute check must
 * not turn a good key red (recette du 18/10). Only a refusal does.
 */
export function isProviderTrouble(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * The `unreachable` outcome with what the provider actually did: a 429 is a quota or a rate limit; a 5xx, a timeout,
 * a network error or an answer Impera cannot read is a provider that is not answering normally. Neither says
 * anything about the key, so the text must not claim it is fine either.
 */
export function unreachableFrom(reply: HttpReply): RefusedKey {
  const reason = reply.kind === 'reply' && reply.status === 429 ? 'rate_limited' : 'outage';
  return { ok: false, kind: 'unreachable', reason };
}
