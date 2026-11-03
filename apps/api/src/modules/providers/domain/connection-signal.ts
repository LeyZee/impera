import type { AiProvider, ConnectionService, ConnectionSignal } from '@impera/contracts';

import type { StoredCredential } from './credential';

/**
 * How long a provider may give no answer before it is told down (Telegram P3-12): three checks of the 15-minute job
 * in a row, so that one slow minute never rings.
 */
export const UNREACHABLE_AFTER_MS = 45 * 60_000;

/** The service an outage alert names; Venice, a fallback, is not watched. */
export function connectionServiceOf(provider: AiProvider): ConnectionService | null {
  return provider === 'venice' ? null : provider;
}

/**
 * What a saved line says of its service: refused or out of credit is down, at once; working is back (kept only after a
 * published `down`). A row that no longer decrypts says nothing: the start-up log tells whoever runs the server.
 */
export function credentialSignal(stored: StoredCredential): ConnectionSignal | null {
  if (stored.key === null) return null;
  switch (stored.state) {
    case 'needs_reconnect':
      return { state: 'down', reason: stored.lastErrorKind === 'no_credit' ? 'low_credit' : 'refused' };
    case 'low_credit':
      return { state: 'down', reason: 'low_credit' };
    case 'connected':
      return { state: 'back' };
  }
}

/**
 * A check found the provider unreachable: an answer leaves the line as it was (`applyReverification`), so its
 * `verifiedAt` is the last answer. Down once no answer came for `UNREACHABLE_AFTER_MS`; a refused line is down already.
 */
export function unreachableSignal(stored: StoredCredential, now: Date): ConnectionSignal | null {
  if (stored.key === null || stored.state === 'needs_reconnect') return null;
  if (now.getTime() - stored.verifiedAt.getTime() < UNREACHABLE_AFTER_MS) return null;
  return { state: 'down', reason: 'unreachable' };
}
