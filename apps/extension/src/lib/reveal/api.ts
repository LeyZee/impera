import {
  CONNECTOR_LINK_FORBIDDEN,
  CONNECTOR_SESSION_CONFLICT,
  ConnectorAccountsSchema,
  ConnectorSessionBodySchema,
  type ConnectorAccounts,
  type PlatformAccountId,
} from '@impera/contracts';

import { call, type Fetch, type Sent } from '../watch/api';

import type { RevealSession } from './capture';

/**
 * The « Sync »'s two doors on the API (P2-01, reveal-connector-spec.md § 2), called by the service worker only, with
 * the owner's link in `x-extension-link`, never the CRM's cookie (ADR 0066 § 7). The session goes once and is dropped.
 */

export function fetchSyncableAccounts(
  origin: string,
  token: string,
  fetchFn: Fetch = fetch,
): Promise<Sent<ConnectorAccounts>> {
  return call(
    fetchFn,
    `${origin}/v1/connector/accounts?platform=reveal`,
    token,
    { method: 'GET' },
    (body) => {
      const parsed = ConnectorAccountsSchema.safeParse(body);
      return parsed.success ? parsed.data : null;
    },
  );
}

/** What became of a « Sync »: stored, or why not. */
export type Synced = 'synced' | 'revoked' | 'not-owner' | 'other-model' | 'refused' | 'unreachable';

export async function sendSession(
  origin: string,
  token: string,
  platformAccountId: PlatformAccountId,
  session: RevealSession,
  fetchFn: Fetch = fetch,
): Promise<Synced> {
  const body = ConnectorSessionBodySchema.parse({ platformAccountId, session: JSON.stringify(session) });
  // 204: no body to read, the answer is the status alone.
  const sent = await call(
    fetchFn,
    `${origin}/v1/connector/sessions`,
    token,
    { method: 'POST', body },
    () => true,
  );
  switch (sent.kind) {
    case 'ok':
      return 'synced';
    case 'revoked':
      return 'revoked';
    case 'unreachable':
      return 'unreachable';
    case 'refused':
      if (sent.code === CONNECTOR_LINK_FORBIDDEN) return 'not-owner';
      if (sent.code === CONNECTOR_SESSION_CONFLICT) return 'other-model';
      return 'refused';
  }
}
