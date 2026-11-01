import { decryptSecret, schema, sql, type Database, type EncryptionKey } from '@nirvana/db';

import { checkProviderKeys } from './modules/providers';
import { checkTelegramTokens } from './modules/telegram';

/**
 * Proves that the copy of the application's encryption keys, kept with the backups' private key (ADR 0028 § 7), still
 * opens the data: every sealed column is decrypted in memory and dropped at once. Nothing is written, nothing is
 * called, and nothing decrypted is returned or logged. Run on a connection opened read only (`READ_ONLY_POOL_OPTIONS`).
 */

/** A pool whose every transaction is read only: the database itself refuses a write. */
export const READ_ONLY_POOL_OPTIONS = { max: 2, options: '-c default_transaction_read_only=on' };

export interface SealedFamily {
  /** What it is, in the owner's words. */
  readonly label: string;
  readonly keys: 'SESSION_ENCRYPTION_KEYS' | 'CREDENTIALS_ENCRYPTION_KEYS';
  readonly total: number;
  /** Which rows the keys do not open, by a name that is never a secret: an account id, a provider, a bot. */
  readonly unreadable: readonly string[];
}

async function checkPlatformSessions(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): Promise<SealedFamily> {
  const rows = await adminDb
    .select({ id: schema.platformAccounts.id, sealed: schema.platformAccounts.sessionCiphertext })
    .from(schema.platformAccounts)
    .where(sql`${schema.platformAccounts.sessionCiphertext} is not null`);
  const unreadable: string[] = [];
  for (const row of rows) {
    if (row.sealed === null) continue;
    try {
      decryptSecret(row.sealed, keys, row.id);
    } catch {
      unreadable.push(row.id);
    }
  }
  return {
    label: 'Sessions des plateformes',
    keys: 'SESSION_ENCRYPTION_KEYS',
    total: rows.length,
    unreadable,
  };
}

export async function checkEncryptionKeys(
  adminDb: Database,
  keys: { readonly session: readonly EncryptionKey[]; readonly credentials: readonly EncryptionKey[] },
): Promise<readonly SealedFamily[]> {
  const [sessions, providers, bots] = await Promise.all([
    checkPlatformSessions(adminDb, keys.session),
    checkProviderKeys(adminDb, keys.credentials),
    checkTelegramTokens(adminDb, keys.credentials),
  ]);
  return [
    sessions,
    { label: 'Clés des services IA', keys: 'CREDENTIALS_ENCRYPTION_KEYS', ...providers },
    { label: 'Jetons des bots Telegram', keys: 'CREDENTIALS_ENCRYPTION_KEYS', ...bots },
  ];
}
