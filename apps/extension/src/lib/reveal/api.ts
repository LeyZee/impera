import {
  CONNECTOR_LINK_FORBIDDEN,
  CONNECTOR_SESSION_CONFLICT,
  CONNECTOR_SESSION_MEMBER_CONFLICT,
  ConnectorAccountsSchema,
  ConnectorSessionBodySchema,
  ConnectorSessionStoredSchema,
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

/** When the session stored ends, and whether a new login to Reveal should come first (ADR 0147 § 5). */
interface Stored {
  readonly expiresAt: string | null;
  readonly reconnectFirst: boolean;
  /** The session in place held longer than the one sent, and stays. */
  readonly kept: boolean;
}

/** A 2xx is a session stored, whatever its body says: an answer without its details only loses the hour. */
const STORED_UNKNOWN: Stored = { expiresAt: null, reconnectFirst: false, kept: false };

/** What became of a « Sync »: stored, or why not. */
export type Synced =
  | { readonly state: 'synced'; readonly stored: Stored }
  | {
      readonly state:
        'revoked' | 'not-owner' | 'other-model' | 'other-member' | 'refused' | 'busy' | 'unreachable';
    };

export async function sendSession(
  origin: string,
  token: string,
  platformAccountId: PlatformAccountId,
  session: RevealSession,
  fetchFn: Fetch = fetch,
  trigger: 'click' | 'open' = 'click',
): Promise<Synced> {
  // The gesture is said when the extension synced alone (ADR 0147 § 2), so that the server and its log tell it apart.
  const body = ConnectorSessionBodySchema.parse({
    platformAccountId,
    session: JSON.stringify(session),
    ...(trigger === 'open' && { trigger }),
  });
  const sent = await call(
    fetchFn,
    `${origin}/v1/connector/sessions`,
    token,
    { method: 'POST', body },
    (answer) => {
      const parsed = ConnectorSessionStoredSchema.safeParse(answer);
      return parsed.success
        ? {
            expiresAt: parsed.data.expiresAt,
            reconnectFirst: parsed.data.reconnectFirst,
            kept: parsed.data.kept,
          }
        : STORED_UNKNOWN;
    },
  );
  switch (sent.kind) {
    case 'ok':
      return { state: 'synced', stored: sent.value };
    case 'revoked':
      return { state: 'revoked' };
    case 'busy':
      return { state: 'busy' };
    case 'unreachable':
      return { state: 'unreachable' };
    case 'refused':
      return { state: refusalOf(sent.code) };
  }
}

/** The server's refusal, told apart so that the popup says its cause and the gesture that mends it. */
function refusalOf(code: string | null): 'not-owner' | 'other-model' | 'other-member' | 'refused' {
  if (code === CONNECTOR_LINK_FORBIDDEN) return 'not-owner';
  if (code === CONNECTOR_SESSION_CONFLICT) return 'other-model';
  if (code === CONNECTOR_SESSION_MEMBER_CONFLICT) return 'other-member';
  return 'refused';
}
