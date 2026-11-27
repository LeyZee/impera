import {
  ApiErrorSchema,
  McpGrantCreatedSchema,
  McpGrantListSchema,
  McpGrantRefusalBodySchema,
  REAUTHENTICATION_ERROR_CODE,
  type CreateMcpGrantBody,
  type McpGrant,
  type McpGrantCreated,
} from '@impera/contracts';

/**
 * Réglages › Agents connectés (ADR 0026 § 3, ADR 0105 § 1): the owner's agent accesses, by the routes the MCP module
 * already serves. The token comes back once, in the creation's answer; the server keeps its hash only.
 */

/** `reauth`: the sign-in is over 10 minutes old, the page asks for the password and a code, then creates again. */
export type GrantFailure = 'reauth' | 'refused' | 'forbidden' | 'failed';

export const GRANT_FAILURES: Readonly<Record<GrantFailure, string>> = {
  reauth: 'Confirme ton mot de passe et ton code pour créer ce jeton.',
  refused: 'Une des lectures cochées n’est pas permise sur cet accès. Décoche-la et réessaie.',
  forbidden: 'Seul le propriétaire connecte un agent.',
  failed: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

export class GrantError extends Error {
  readonly kind: GrantFailure;

  constructor(kind: GrantFailure) {
    super(GRANT_FAILURES[kind]);
    this.name = 'GrantError';
    this.kind = kind;
  }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`/v1/settings/mcp-grants${path}`, {
    credentials: 'include',
    ...init,
  }).catch(() => null);
  if (response === null) throw new GrantError('failed');
  if (response.status === 403) {
    const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    throw new GrantError(error.data?.error.code === REAUTHENTICATION_ERROR_CODE ? 'reauth' : 'forbidden');
  }
  if (response.status === 422) {
    // The refusal's kind says which rule; the screen ticks only what the rules open, so one sentence is enough.
    McpGrantRefusalBodySchema.safeParse(await response.json().catch(() => null));
    throw new GrantError('refused');
  }
  return response;
}

/** The owner's accesses, the newest first, revoked and expired ones included. */
export async function fetchGrants(): Promise<readonly McpGrant[]> {
  const response = await call('');
  if (!response.ok) throw new GrantError('failed');
  const parsed = McpGrantListSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new GrantError('failed');
  return parsed.data.items;
}

/** A new access and its token, shown this once. */
export async function createGrant(body: CreateMcpGrantBody): Promise<McpGrantCreated> {
  const response = await call('', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new GrantError('failed');
  const parsed = McpGrantCreatedSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new GrantError('failed');
  return parsed.data;
}

/** Revokes an access for good: its token opens nothing more. One already revoked counts as revoked. */
export async function revokeGrant(id: string): Promise<void> {
  const response = await call(`/${id}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new GrantError('failed');
}
