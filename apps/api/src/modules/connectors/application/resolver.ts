import { PlatformSchema, type Platform } from '@impera/contracts';

import { SessionVaultMissing } from '../domain/errors';
import type { PlatformConnector } from '../domain/platform-connector';
import type { AccountStore, ConnectorAccount, ConnectorRegistry, SessionVault } from '../domain/ports';

export interface ConnectorResolver {
  /** Platforms that have an adapter: only their accounts are polled. */
  readonly platforms: readonly Platform[];
  /** The account's connector, built once per stored session; `null` when its platform has no adapter. */
  forAccount(account: ConnectorAccount): Promise<PlatformConnector | null>;
}

/** One client per account (connectors.md § Règles de bonne conduite), rebuilt when a new session is stored. */
export function createConnectorResolver(deps: {
  readonly accounts: AccountStore;
  readonly vault: SessionVault | null;
  readonly registry: ConnectorRegistry;
}): ConnectorResolver {
  const cache = new Map<string, { readonly stamp: string; readonly connector: PlatformConnector }>();
  return {
    platforms: PlatformSchema.options.filter((platform) => deps.registry[platform] !== undefined),
    async forAccount(account) {
      const factory = deps.registry[account.platform];
      if (factory === undefined) return null;
      const sealed = await deps.accounts.sessionOf(account.creatorId, account.id);
      const stamp = sealed?.toString('base64') ?? '';
      const cached = cache.get(account.id);
      if (cached?.stamp === stamp) return cached.connector;
      let session: string | null = null;
      if (sealed !== null) {
        if (deps.vault === null) throw new SessionVaultMissing();
        session = deps.vault.open(account.id, sealed);
      }
      const connector = factory(account, session);
      cache.set(account.id, { stamp, connector });
      return connector;
    },
  };
}
