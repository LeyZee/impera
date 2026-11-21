import {
  ApiErrorSchema,
  LinkServiceRefusalBodySchema,
  LinkServiceStatusSchema,
  REAUTHENTICATION_ERROR_CODE,
  refusalOf,
  type LinkServiceRefusalKind,
  type LinkServiceStatus,
} from '@impera/contracts';

import { ReauthRequired, ServicesError } from '@/settings/services/api';

/**
 * `/v1/settings/link-service` (INS-02): the agency's key of the redirect service. The key goes up once, in the body
 * of `PUT …/key`; no answer ever brings it back, even masked. Every answer is parsed with the contract.
 */

const BASE = '/v1/settings/link-service';

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const what = `${init.method ?? 'GET'} ${BASE}${path}`;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { credentials: 'include', ...init });
  } catch {
    throw new ServicesError('unavailable', `${what}: réseau`);
  }
  if (response.ok || response.status === 422) return response;
  const detail = `${what}: ${String(response.status)}`;
  if (response.status === 401) throw new ServicesError('session_expired', detail);
  if (response.status === 429) throw new ServicesError('rate_limited', detail);
  if (response.status === 403) {
    const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    const code = body.success ? body.data.error.code : null;
    if (code === REAUTHENTICATION_ERROR_CODE) throw new ReauthRequired();
    if (code === 'role_forbidden') throw new ServicesError('forbidden', detail);
  }
  throw new ServicesError('unavailable', detail);
}

async function parsed<T>(response: Response, parse: (body: unknown) => T): Promise<T> {
  try {
    return parse(await response.json());
  } catch {
    throw new ServicesError('unavailable', `réponse inattendue (${String(response.status)})`);
  }
}

export async function fetchLinkService(): Promise<LinkServiceStatus> {
  return parsed(await call(''), (body) => LinkServiceStatusSchema.parse(body));
}

export type ConnectResult =
  | { readonly ok: true; readonly status: LinkServiceStatus }
  | {
      readonly ok: false;
      readonly refusal: { readonly kind: LinkServiceRefusalKind; readonly message: string };
    };

/** Checked at the service before it is kept: a key it refuses is never saved, and the reason comes back. */
export async function connectLinkServiceKey(key: string): Promise<ConnectResult> {
  const response = await call('/key', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  return parsed(response, (body): ConnectResult =>
    response.status === 422
      ? { ok: false, refusal: refusalOf(LinkServiceRefusalBodySchema.parse(body)) }
      : { ok: true, status: LinkServiceStatusSchema.parse(body) },
  );
}

export async function disconnectLinkService(): Promise<LinkServiceStatus> {
  return parsed(await call('', { method: 'DELETE' }), (body) => LinkServiceStatusSchema.parse(body));
}
