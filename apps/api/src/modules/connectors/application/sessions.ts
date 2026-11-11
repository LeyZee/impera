import type { CreatorId, PlatformAccountId } from '@impera/contracts';

import {
  PlatformAccountNotFound,
  SessionOwnerConflict,
  SessionShapeUnprocessable,
  SessionVaultMissing,
} from '../domain/errors';
import type { AccountStore, Clock, SessionShapes, SessionVault } from '../domain/ports';

export interface ConnectorSessions {
  /**
   * Stores the session the extension captured, encrypted; the account becomes `valid` and its breaker closes. Refused
   * when it is not a session of the account's platform, or when it belongs to another creator than the one stored.
   */
  store(input: {
    platformAccountId: PlatformAccountId;
    session: string;
    correlationId: string;
    /** Who synced it (the owner's link), for the audit. */
    userId: string | null;
  }): Promise<void>;
  /** The decrypted session, or `null` when none was captured. Never logged, never sent to a client. */
  load(creatorId: CreatorId, platformAccountId: PlatformAccountId): Promise<string | null>;
  markExpired(
    creatorId: CreatorId,
    platformAccountId: PlatformAccountId,
    correlationId: string,
  ): Promise<void>;
}

/** Platform sessions at rest (security.md, ADR 0008): AES-256-GCM bound to the account id. */
export function createConnectorSessions(deps: {
  readonly accounts: AccountStore;
  readonly vault: SessionVault | null;
  readonly clock: Clock;
  /** How each platform's session reads; a platform without a reader takes no session. */
  readonly shapes: SessionShapes;
}): ConnectorSessions {
  const vault = (): SessionVault => {
    if (deps.vault === null) throw new SessionVaultMissing();
    return deps.vault;
  };
  return {
    async store({ platformAccountId, session, correlationId, userId }) {
      const account = await deps.accounts.creatorOf(platformAccountId);
      if (account === null) throw new PlatformAccountNotFound();
      const { creatorId } = account;
      const shape = deps.shapes[account.platform];
      const read = shape === undefined ? null : shape(session);
      if (shape === undefined || read === null) throw new SessionShapeUnprocessable();
      // A session of another creator would make this account speak for her: refused, whatever the state.
      const previous = await deps.accounts.sessionOf(creatorId, platformAccountId);
      const before = previous === null ? null : openOrNull(vault(), platformAccountId, previous);
      const beforeOwner = before === null ? null : (shape(before)?.owner ?? null);
      if (beforeOwner !== null && beforeOwner !== read.owner) throw new SessionOwnerConflict();
      const sealed = vault().seal(platformAccountId, session);
      await deps.accounts.storeSession(
        creatorId,
        platformAccountId,
        {
          ciphertext: sealed,
          // Compared in clear: GCM seals the same session differently each time. One that no longer opens (a retired
          // key) is not the same.
          isSame: (stored) => openOrNull(vault(), platformAccountId, stored) === session,
        },
        {
          correlationId,
          at: deps.clock.now(),
          userId,
        },
      );
    },
    async load(creatorId, platformAccountId) {
      const sealed = await deps.accounts.sessionOf(creatorId, platformAccountId);
      return sealed === null ? null : vault().open(platformAccountId, sealed);
    },
    markExpired: (creatorId, platformAccountId, correlationId) =>
      deps.accounts.setSessionState(creatorId, platformAccountId, 'expired', {
        correlationId,
        at: deps.clock.now(),
      }),
  };
}

function openOrNull(
  vault: SessionVault,
  platformAccountId: PlatformAccountId,
  sealed: Buffer,
): string | null {
  try {
    return vault.open(platformAccountId, sealed);
  } catch {
    return null;
  }
}
