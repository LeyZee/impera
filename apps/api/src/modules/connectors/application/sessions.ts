import type { CreatorId, PlatformAccountId } from '@nirvana/contracts';

import { PlatformAccountNotFound, SessionVaultMissing } from '../domain/errors';
import type { AccountStore, Clock, SessionVault } from '../domain/ports';

export interface ConnectorSessions {
  /** Stores the session the extension captured, encrypted; the account becomes `valid` and its breaker closes. */
  store(input: {
    platformAccountId: PlatformAccountId;
    session: string;
    correlationId: string;
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
}): ConnectorSessions {
  const vault = (): SessionVault => {
    if (deps.vault === null) throw new SessionVaultMissing();
    return deps.vault;
  };
  return {
    async store({ platformAccountId, session, correlationId }) {
      const creatorId = await deps.accounts.creatorOf(platformAccountId);
      if (creatorId === null) throw new PlatformAccountNotFound();
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
          userId: null,
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
