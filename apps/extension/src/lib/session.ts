import { ApiErrorSchema, MeSchema, SECOND_FACTOR_ERROR_CODE, type Me } from '@impera/contracts';

/**
 * The session the CRM opened in this browser (ADR 0066 § 2): `GET /v1/me` with the browser's cookie, which is
 * `HttpOnly`, so the extension never reads, copies nor keeps it. Nothing is written to the API from here.
 */
export type CrmSession =
  | { readonly kind: 'signed_in'; readonly me: Me }
  | { readonly kind: 'signed_out' }
  /** Signed in with the password, the code not active yet: only the CRM can finish it (ADR 0046). */
  | { readonly kind: 'second_factor_required' }
  /** The CRM answers with a server error (500 to 599): the address is right, the CRM is not well (EXT-08). */
  | { readonly kind: 'server_down' }
  /** The CRM knows the account and refuses it the extension (a 403 that is not the code to activate). */
  | { readonly kind: 'refused' }
  /** Something answers at the address, but not the CRM: a page, a 404, an answer outside the contract (EXT-08). */
  | { readonly kind: 'not_crm' }
  /** No answer at all, or none in time: the address is wrong or the CRM is down. */
  | { readonly kind: 'unreachable' };

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** A CRM that takes longer than this to say who is signed in is reported as unreachable. */
const SESSION_TIMEOUT_MS = 6000;

async function errorCodeOf(response: Response): Promise<string | null> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.code : null;
}

export async function readCrmSession(origin: string, fetchFn: Fetch = fetch): Promise<CrmSession> {
  let response: Response;
  try {
    response = await fetchFn(`${origin}/v1/me`, {
      credentials: 'include',
      // A CRM answers here itself: a redirect is not followed, whoever it would lead to (ADR 0067, amendement du 19/11).
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
    });
  } catch {
    return { kind: 'unreachable' };
  }
  if (response.status === 401) return { kind: 'signed_out' };
  if (response.status === 403) {
    return (await errorCodeOf(response)) === SECOND_FACTOR_ERROR_CODE
      ? { kind: 'second_factor_required' }
      : { kind: 'refused' };
  }
  // The CRM's server (Vite in development, nginx once deployed) or the API itself: a 5xx is the CRM, unwell.
  if (response.status >= 500) return { kind: 'server_down' };
  if (!response.ok) return { kind: 'not_crm' };
  const me = MeSchema.safeParse(await response.json().catch(() => null));
  return me.success ? { kind: 'signed_in', me: me.data } : { kind: 'not_crm' };
}
