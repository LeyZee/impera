import {
  ApiErrorSchema,
  MeSchema,
  SECOND_FACTOR_ERROR_CODE,
  SecondFactorSetupSchema,
  SignInAnswerSchema,
  type Me,
  type SecondFactorSetup,
} from '@impera/contracts';

/**
 * Dashboard session, through the API under `/v1` (proxied to the API in development, same origin in production
 * behind the reverse proxy): the cookie is `HttpOnly`, so the page never sees it and asks `/v1/me` instead.
 */

const JSON_HEADERS = { 'content-type': 'application/json' };

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

async function errorCodeOf(response: Response): Promise<string | null> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.code : null;
}

export type CurrentSession =
  | { readonly kind: 'signed_in'; readonly user: Me }
  | { readonly kind: 'signed_out' }
  /** Signed in with the password, the second factor not active yet: the activation is the only screen (ADR 0046). */
  | { readonly kind: 'second_factor_required' };

/** The session as the app opens it: who is signed in, nobody, or an account that must activate its code first. */
export async function readSession(): Promise<CurrentSession> {
  const response = await fetch('/v1/me', { credentials: 'include' });
  if (response.status === 401) return { kind: 'signed_out' };
  if (response.status === 403 && (await errorCodeOf(response)) === SECOND_FACTOR_ERROR_CODE) {
    return { kind: 'second_factor_required' };
  }
  if (!response.ok) throw new Error(`GET /v1/me: ${String(response.status)}`);
  return { kind: 'signed_in', user: MeSchema.parse(await response.json()) };
}

/** The signed-in user with his team role and scope (ADR 0024), or `null` when no session opens the dashboard. */
export async function fetchCurrentUser(): Promise<Me | null> {
  const session = await readSession();
  return session.kind === 'signed_in' ? session.user : null;
}

export type SignInResult =
  | 'ok'
  /** The password was right; the code of the authenticator app comes next (ADR 0046). */
  | 'code_required'
  | 'wrong_credentials'
  | 'too_many_attempts'
  | 'unavailable';

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const response = await post('/v1/auth/sign-in/email', { email, password });
  if (response.ok) {
    const answer = SignInAnswerSchema.safeParse(await response.json().catch(() => null));
    return answer.success && 'twoFactorRedirect' in answer.data ? 'code_required' : 'ok';
  }
  if (response.status === 401 || response.status === 400) return 'wrong_credentials';
  if (response.status === 429) return 'too_many_attempts';
  return 'unavailable';
}

/**
 * A code as the server reads it (recette 05/11, SEC-08): spaces dropped, a dash typed or autocorrected as « – » or « — »
 * made a plain one, and a backup code typed without its dash given it back (`aB3dE9fGh1` → `aB3dE-9fGh1`). Letters keep
 * their case: the stored backup codes are compared as they were made.
 */
export function normalizeCode(raw: string): string {
  const code = raw.replace(/\s+/gu, '').replace(/[\u2010-\u2015\u2212_]/gu, '-');
  return /^[A-Za-z0-9]{10}$/u.test(code) && !/^\d+$/u.test(code)
    ? `${code.slice(0, 5)}-${code.slice(5)}`
    : code;
}

export type CodeResult =
  | 'ok'
  | 'wrong_code'
  /** The code step of the sign-in expired or ran out of tries: back to the password. */
  | 'expired'
  /** Ten wrong codes in a row: the account's code waits 15 minutes. */
  | 'locked'
  | 'too_many_attempts'
  | 'unavailable';

function codeResultOf(status: number, code: string | null): CodeResult {
  if (code === 'second_factor_unauthenticated') return 'wrong_code';
  if (code === 'second_factor_challenge_unauthenticated') return 'expired';
  if (code === 'second_factor_limited') return 'locked';
  if (code === 'request_invalid' || (code === null && status === 400)) return 'wrong_code';
  if (status === 429) return 'too_many_attempts';
  return 'unavailable';
}

/**
 * The code of a sign-in: the authenticator's 6 digits, or a backup code (used up). `trustDevice` spares this browser
 * the code for 30 days, never before a sensitive action.
 */
export async function verifySignInCode(
  code: string,
  options: { readonly backup: boolean; readonly trustDevice: boolean },
): Promise<CodeResult> {
  const path = options.backup ? '/v1/auth/two-factor/verify-backup-code' : '/v1/auth/two-factor/verify-totp';
  const response = await post(path, { code: normalizeCode(code), trustDevice: options.trustDevice });
  if (response.ok) return 'ok';
  return codeResultOf(response.status, await errorCodeOf(response));
}

export type ActivationStart =
  | { readonly kind: 'ok'; readonly setup: SecondFactorSetup }
  | { readonly kind: 'wrong_password' | 'session_expired' | 'too_many_attempts' | 'unavailable' };

/** The activation, first step: the password once more; answers the secret and the ten backup codes, shown once. */
export async function startActivation(password: string): Promise<ActivationStart> {
  const response = await post('/v1/auth/two-factor/enable', { password });
  if (response.ok) {
    const setup = SecondFactorSetupSchema.safeParse(await response.json().catch(() => null));
    return setup.success ? { kind: 'ok', setup: setup.data } : { kind: 'unavailable' };
  }
  const code = await errorCodeOf(response);
  if (code === 'password_unauthenticated') return { kind: 'wrong_password' };
  if (response.status === 401) return { kind: 'session_expired' };
  if (response.status === 429) return { kind: 'too_many_attempts' };
  return { kind: 'unavailable' };
}

/** The activation, second step: the first code from the app. Right, the account's code is active. */
export async function confirmActivation(code: string): Promise<CodeResult> {
  const response = await post('/v1/auth/two-factor/verify-totp', { code: normalizeCode(code) });
  if (response.ok) return 'ok';
  return codeResultOf(response.status, await errorCodeOf(response));
}

export type ReauthenticateResult =
  | 'ok'
  /** A wrong password or a wrong code: the server does not tell which. */
  | 'wrong_credentials'
  | 'too_many_attempts'
  | 'unavailable'
  /** No session at all: only the sign-in page can help. */
  | 'session_expired';

/** The password and a code, before a sensitive action (ADR 0046 § 3): the action can be retried for 10 minutes. */
export async function reauthenticate(password: string, code: string): Promise<ReauthenticateResult> {
  const response = await post('/v1/auth/reauthenticate', { password, code: normalizeCode(code) });
  if (response.ok) return 'ok';
  const error = await errorCodeOf(response);
  if (error === 'reauthentication_unauthenticated' || error === 'request_invalid') return 'wrong_credentials';
  if (response.status === 401) return 'session_expired';
  if (response.status === 429) return 'too_many_attempts';
  return 'unavailable';
}

/** Throws when the server did not close the session (no answer, or a refusal): the screen must say so. */
export async function signOut(): Promise<void> {
  const response = await post('/v1/auth/sign-out', {});
  if (!response.ok) throw new Error(`POST /v1/auth/sign-out: ${String(response.status)}`);
}
