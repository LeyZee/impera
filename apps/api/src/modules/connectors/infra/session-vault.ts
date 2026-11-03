import { decryptSecret, encryptSecret, type EncryptionKey } from '@impera/db';

import type { SessionVault } from '../domain/ports';

/** `SESSION_ENCRYPTION_KEYS` (newest first): the account id is the associated data, a ciphertext moved elsewhere fails. */
export function createSessionVault(keys: readonly EncryptionKey[]): SessionVault {
  return {
    seal: (platformAccountId, session) => encryptSecret(session, keys, platformAccountId),
    open: (platformAccountId, sealed) => decryptSecret(sealed, keys, platformAccountId),
  };
}
