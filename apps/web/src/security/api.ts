import {
  AccountsSecuritySchema,
  ApiErrorSchema,
  BackupCodesSchema,
  ClosedSessionsSchema,
  OpenSessionsSchema,
  PasskeysSchema,
  REAUTHENTICATION_ERROR_CODE,
  RemovedPasskeysSchema,
  type AccountSecurity,
  type ClosedSessions,
  type OpenSession,
  type Passkey,
} from '@impera/contracts';

/**
 * Réglages › Sécurité (ADR 0046 § 7, SEC-04): one's own sessions and backup codes, and for the owner each account's
 * second factor. Every call goes through `/v1` with the session cookie; a refusal becomes a `SecurityError` the screen
 * says in French.
 */

export type SecurityErrorKind =
  'session_expired' | 'reauth_required' | 'wrong_credentials' | 'too_many_attempts' | 'unavailable';

export const SECURITY_ERROR_MESSAGES: Readonly<Record<SecurityErrorKind, string>> = {
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
  reauth_required: 'Confirme ton mot de passe et ton code pour cette action.',
  wrong_credentials: 'Mot de passe ou code incorrect.',
  too_many_attempts: 'Trop d’essais. Attends quelques minutes avant de réessayer.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

export class SecurityError extends Error {
  readonly kind: SecurityErrorKind;

  constructor(kind: SecurityErrorKind) {
    super(SECURITY_ERROR_MESSAGES[kind]);
    this.name = 'SecurityError';
    this.kind = kind;
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' };

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`/v1${path}`, { credentials: 'include', ...init }).catch(() => null);
  if (response === null) throw new SecurityError('unavailable');
  return response;
}

async function refusalOf(response: Response): Promise<SecurityError> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  const code = parsed.success ? parsed.data.error.code : null;
  if (code === REAUTHENTICATION_ERROR_CODE) return new SecurityError('reauth_required');
  if (code === 'reauthentication_unauthenticated' || code === 'request_invalid') {
    return new SecurityError('wrong_credentials');
  }
  if (response.status === 401) return new SecurityError('session_expired');
  if (response.status === 429) return new SecurityError('too_many_attempts');
  return new SecurityError('unavailable');
}

async function read<T>(response: Response, parse: (body: unknown) => T): Promise<T> {
  if (!response.ok) throw await refusalOf(response);
  try {
    return parse(await response.json());
  } catch {
    throw new SecurityError('unavailable');
  }
}

/** One's open sessions, the most recently used first. */
export async function fetchSessions(): Promise<readonly OpenSession[]> {
  return read(await call('/auth/sessions'), (body) => OpenSessionsSchema.parse(body).sessions);
}

/** Closes one of one's other sessions; one already closed elsewhere counts as closed. */
export async function closeSession(id: string): Promise<void> {
  const response = await call(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (response.ok || response.status === 404) return;
  throw await refusalOf(response);
}

/** Every session but this one, and every trusted device. */
export async function closeOtherSessions(): Promise<ClosedSessions> {
  return read(await call('/auth/sessions/close-others', { method: 'POST' }), (body) =>
    ClosedSessionsSchema.parse(body),
  );
}

/** Ten new backup codes, against the password and a code; the old ones stop working. */
export async function generateBackupCodes(password: string, code: string): Promise<readonly string[]> {
  const response = await call('/auth/two-factor/generate-backup-codes', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ password, code }),
  });
  return read(response, (body) => BackupCodesSchema.parse(body).backupCodes);
}

/** For the owner: each account's second factor and open sessions. */
export async function fetchAccounts(): Promise<readonly AccountSecurity[]> {
  return read(
    await call('/settings/security/accounts'),
    (body) => AccountsSecuritySchema.parse(body).accounts,
  );
}

/** For the owner: closes every session of an account, with its trusted devices (a sensitive action). */
export async function closeAccountSessions(userId: string): Promise<ClosedSessions> {
  const response = await call(`/settings/security/accounts/${encodeURIComponent(userId)}/close-sessions`, {
    method: 'POST',
  });
  return read(response, (body) => ClosedSessionsSchema.parse(body));
}

/** One's passkeys (ADR 0053 § 5): the device each was added from, its keychain, when added and last used. */
export async function fetchOwnPasskeys(): Promise<readonly Passkey[]> {
  return read(await call('/auth/passkeys'), (body) => PasskeysSchema.parse(body).passkeys);
}

/** Removes one of one's keys (a sensitive action); one already removed counts as removed. */
export async function removePasskey(id: string): Promise<void> {
  const response = await call(`/auth/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (response.ok || response.status === 404) return;
  throw await refusalOf(response);
}

/** For the owner: removes every key of an account (a sensitive action); answers how many went. */
export async function removeAccountPasskeys(userId: string): Promise<number> {
  const response = await call(`/settings/security/accounts/${encodeURIComponent(userId)}/remove-passkeys`, {
    method: 'POST',
  });
  return read(response, (body) => RemovedPasskeysSchema.parse(body).passkeys);
}
