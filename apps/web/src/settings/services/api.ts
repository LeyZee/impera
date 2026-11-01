import {
  ApiErrorSchema,
  ProviderOverviewSchema,
  REAUTHENTICATION_ERROR_CODE,
  ProviderRefusalSchema,
  ProviderStatusSchema,
  type AiProvider,
  type ProviderOverview,
  type ProviderRefusal,
  type ProviderSettings,
  type ProviderStatus,
} from '@nirvana/contracts';

import { fetchCurrentUser, signIn, type SignInResult } from '../../auth/session';

/**
 * `/v1/settings/providers` (fiche P3-03). The key goes up once, in the body of `PUT …/key`; no answer ever brings
 * it back. Every answer is parsed with the contract: a shape the page does not expect is an error, not a guess.
 */

const BASE = '/v1/settings/providers';
const JSON_HEADERS = { 'content-type': 'application/json' };

/**
 * Connecting, replacing or removing a key asks for a sign-in under 10 minutes (ADR 0016): the page asks for the
 * password (`confirmPassword`), then runs the action again.
 */
export class ReauthRequired extends Error {
  constructor() {
    super('Mot de passe à confirmer');
    this.name = 'ReauthRequired';
  }
}

/**
 * Why a call failed, as the page tells it: `session_expired` (401) offers to sign in again, `forbidden` is a
 * member who is not the owner, `rate_limited` is 429, `unavailable` is everything else (no network, 5xx, an
 * answer the contract refuses).
 */
export type ServicesErrorKind = 'session_expired' | 'forbidden' | 'rate_limited' | 'unavailable';

const ERROR_MESSAGES: Record<ServicesErrorKind, string> = {
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
  forbidden: 'Seul le compte propriétaire peut gérer les clés.',
  rate_limited: 'Trop d’essais. Attends une minute avant de réessayer.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

export class ServicesError extends Error {
  readonly kind: ServicesErrorKind;

  constructor(kind: ServicesErrorKind, detail: string) {
    super(`${ERROR_MESSAGES[kind]} (${detail})`);
    this.name = 'ServicesError';
    this.kind = kind;
  }
}

/** The one French sentence the page shows for a failed call. */
export function describeError(error: unknown): string {
  return ERROR_MESSAGES[error instanceof ServicesError ? error.kind : 'unavailable'];
}

/** A member who is not the owner (403 `role_forbidden`): retrying changes nothing. */
export function isForbidden(error: unknown): boolean {
  return error instanceof ServicesError && error.kind === 'forbidden';
}

/** A 401 somewhere on the page: the only way out is to sign in again (`window.location.reload()`). */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ServicesError && error.kind === 'session_expired';
}

/** An error as a component keeps it: the sentence, and whether to offer « Se reconnecter ». */
export interface ShownError {
  readonly message: string;
  readonly isSessionExpired: boolean;
}

/** `lead` says what did not happen (« La voix n’a pas été enregistrée. »), before the reason. */
export function showError(error: unknown, lead?: string): ShownError {
  const reason = describeError(error);
  return {
    message: lead === undefined ? reason : `${lead} ${reason}`,
    isSessionExpired: isSessionExpired(error),
  };
}

async function errorCode(response: Response): Promise<string | null> {
  const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return body.success ? body.data.error.code : null;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const what = `${init.method ?? 'GET'} ${path}`;
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
    const code = await errorCode(response);
    if (code === REAUTHENTICATION_ERROR_CODE) throw new ReauthRequired();
    if (code === 'role_forbidden') throw new ServicesError('forbidden', detail);
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

export type ConfirmResult = SignInResult | 'session_expired';

/**
 * Signs in again as the current user: a fresh session, so the key action can be retried. No session at all is
 * `session_expired`, not a wrong password: only the sign-in page can help then.
 */
export async function confirmPassword(password: string): Promise<ConfirmResult> {
  const user = await fetchCurrentUser();
  if (user === null) return 'session_expired';
  return signIn(user.email, password);
}

export async function fetchOverview(): Promise<ProviderOverview> {
  return parsed(await call(''), (body) => ProviderOverviewSchema.parse(body));
}

export type ConnectResult = { ok: true; status: ProviderStatus } | { ok: false; refusal: ProviderRefusal };

export async function connectKey(provider: AiProvider, key: string): Promise<ConnectResult> {
  const response = await call(`/${provider}/key`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ key }),
  });
  return parsed(response, (body): ConnectResult =>
    response.status === 422
      ? { ok: false, refusal: ProviderRefusalSchema.parse(body) }
      : { ok: true, status: ProviderStatusSchema.parse(body) },
  );
}

export async function verifyNow(provider: AiProvider): Promise<ProviderStatus> {
  return parsed(await call(`/${provider}/verify`, { method: 'POST' }), (body) =>
    ProviderStatusSchema.parse(body),
  );
}

export async function saveSettings(
  provider: AiProvider,
  settings: ProviderSettings,
): Promise<ProviderStatus> {
  const response = await call(`/${provider}/settings`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(settings),
  });
  return parsed(response, (body) => ProviderStatusSchema.parse(body));
}

export async function disconnect(provider: AiProvider): Promise<ProviderStatus> {
  return parsed(await call(`/${provider}`, { method: 'DELETE' }), (body) => ProviderStatusSchema.parse(body));
}
