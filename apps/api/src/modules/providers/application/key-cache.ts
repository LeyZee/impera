import type { AiProvider } from '@impera/contracts';

import type { CredentialStore } from '../domain/ports';

/**
 * The synchronous key lookup the LLM gateway and the speech client read (`ApiKeySource`, ADR 0016). It mirrors the
 * saved keys in memory and is reloaded after every change; a server restart reloads it from the database.
 */
export interface KeyCache {
  lookup(provider: AiProvider): string | undefined;
  /**
   * When this process last started handing out a different key for the service (ms), undefined if it has handed out
   * the same one since start-up. Calls already running may still finish with the previous key for a while.
   */
  changedAt(provider: AiProvider): number | undefined;
  reload(): Promise<void>;
}

/**
 * `environmentFallback` is null in production: there, only the dashboard counts. A key that needs reconnecting is
 * not handed out, so the gateway moves to the role's fallback model at once instead of collecting more refusals.
 */
export function createKeyCache(
  store: CredentialStore,
  environmentFallback: ((provider: AiProvider) => string | undefined) | null,
  now: () => number = Date.now,
): KeyCache {
  let keys = new Map<AiProvider, string | null>();
  let loaded = false;
  const changes = new Map<AiProvider, number>();
  const lookup = (provider: AiProvider): string | undefined => {
    if (keys.has(provider)) return keys.get(provider) ?? undefined;
    return environmentFallback?.(provider);
  };
  return {
    lookup,
    changedAt: (provider) => changes.get(provider),
    async reload() {
      const saved = await store.list();
      const before = new Map(saved.map((c) => [c.provider, lookup(c.provider)]));
      for (const provider of keys.keys()) before.set(provider, lookup(provider));
      keys = new Map(saved.map((c) => [c.provider, c.state === 'needs_reconnect' ? null : c.key]));
      if (loaded) {
        for (const [provider, previous] of before) {
          if (lookup(provider) !== previous) changes.set(provider, now());
        }
      }
      loaded = true;
    },
  };
}
