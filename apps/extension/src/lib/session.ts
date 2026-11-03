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
  /** No answer, or one that is not the CRM's: the address is wrong or the CRM is down. */
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
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
    });
  } catch {
    return { kind: 'unreachable' };
  }
  if (response.status === 401) return { kind: 'signed_out' };
  if (response.status === 403 && (await errorCodeOf(response)) === SECOND_FACTOR_ERROR_CODE) {
    return { kind: 'second_factor_required' };
  }
  if (!response.ok) return { kind: 'unreachable' };
  const me = MeSchema.safeParse(await response.json().catch(() => null));
  return me.success ? { kind: 'signed_in', me: me.data } : { kind: 'unreachable' };
}
