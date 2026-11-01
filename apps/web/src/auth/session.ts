import { MeSchema, type Me } from '@nirvana/contracts';

/**
 * Dashboard session, through the API under `/v1` (proxied to the API in development, same origin in production
 * behind the reverse proxy): the cookie is `HttpOnly`, so the page never sees it and asks `/v1/me` instead.
 */

const JSON_HEADERS = { 'content-type': 'application/json' };

/** The signed-in user with his team role and scope (ADR 0024), or `null` when there is no valid session. */
export async function fetchCurrentUser(): Promise<Me | null> {
  const response = await fetch('/v1/me', { credentials: 'include' });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`GET /v1/me: ${String(response.status)}`);
  return MeSchema.parse(await response.json());
}

export type SignInResult = 'ok' | 'wrong_credentials' | 'too_many_attempts' | 'unavailable';

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const response = await fetch('/v1/auth/sign-in/email', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  if (response.ok) return 'ok';
  if (response.status === 401 || response.status === 400) return 'wrong_credentials';
  if (response.status === 429) return 'too_many_attempts';
  return 'unavailable';
}

/** Throws when the server did not close the session (no answer, or a refusal): the screen must say so. */
export async function signOut(): Promise<void> {
  const response = await fetch('/v1/auth/sign-out', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: '{}',
  });
  if (!response.ok) throw new Error(`POST /v1/auth/sign-out: ${String(response.status)}`);
}
