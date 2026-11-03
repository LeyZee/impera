import type { AiProvider } from '@impera/contracts';

import type { StoredCredential } from '../domain/credential';
import type { CredentialStore } from '../domain/ports';

/** Tests, and development without CREDENTIALS_ENCRYPTION_KEYS. Nothing persists. */
export function createMemoryCredentialStore(): CredentialStore {
  const rows = new Map<AiProvider, StoredCredential>();
  let version = 0;
  return {
    find: (provider) => Promise.resolve(rows.get(provider) ?? null),
    list: () => Promise.resolve([...rows.values()]),
    save: (credential) => {
      version += 1;
      rows.set(credential.provider, { ...credential, revision: version });
      return Promise.resolve();
    },
    update: (credential) => {
      const current = rows.get(credential.provider);
      if (current?.revision !== credential.revision) return Promise.resolve(false);
      version += 1;
      rows.set(credential.provider, { ...credential, key: current.key, revision: version });
      return Promise.resolve(true);
    },
    remove: (provider) => {
      rows.delete(provider);
      return Promise.resolve();
    },
  };
}
