import { createHash } from 'node:crypto';

import { AuditEntryIdSchema, newId } from '@impera/contracts';
import {
  decryptSecret,
  encryptSecret,
  keyVersionOf,
  schema,
  withAdmin,
  type Database,
  type EncryptionKey,
} from '@impera/db';

import type { LinkServiceKeyStore } from '../../domain/link-service';

const table = schema.linkServiceCredentials;

/** The associated data the key is sealed with: its ciphertext copied to another table does not open there. */
const CONTEXT = 'link_service';

/**
 * Enough to tell a replacement in `audit_log`, nothing usable: 8 hex characters of the SHA-256 of the sealed value,
 * never of the key itself. Sealing is randomised, so it says « another seal », not « another key ».
 */
function fingerprint(sealed: Buffer): string {
  return createHash('sha256').update(sealed).digest('hex').slice(0, 8);
}

/**
 * `link_service_credentials` through the service role only (the migration closes it to `nirvana_app`), the key sealed
 * with CREDENTIALS_ENCRYPTION_KEYS like the sales feed keys. A row no listed key opens reads as a key to paste again,
 * its ciphertext untouched.
 */
export function createLinkServiceKeyStore(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): LinkServiceKeyStore {
  return {
    async find() {
      const [row] = await withAdmin(adminDb, (tx) => tx.select().from(table));
      if (row === undefined) return null;
      let key: string | null;
      try {
        key = decryptSecret(row.keyCiphertext, keys, CONTEXT);
      } catch {
        key = null;
      }
      return { key, connectedAt: row.updatedAt };
    },

    async save(key, at, by) {
      const sealed = encryptSecret(key, keys, CONTEXT);
      const values = { keyCiphertext: sealed, keyVersion: keyVersionOf(sealed), updatedAt: at };
      await withAdmin(adminDb, async (tx) => {
        const [before] = await tx.select({ singleton: table.singleton }).from(table).for('update');
        await tx
          .insert(table)
          .values({ singleton: true, createdAt: at, ...values })
          .onConflictDoUpdate({ target: table.singleton, set: values });
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: by.userId,
          ip: by.ip,
          action: before === undefined ? 'link_service_key.connected' : 'link_service_key.replaced',
          entity: 'link_service_credential',
          entityId: null,
          details: { fingerprint: fingerprint(sealed) },
        });
      });
    },

    remove(by) {
      return withAdmin(adminDb, async (tx) => {
        const removed = await tx.delete(table).returning({ singleton: table.singleton });
        if (removed.length === 0) return false;
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: by.userId,
          ip: by.ip,
          action: 'link_service_key.disconnected',
          entity: 'link_service_credential',
          entityId: null,
          details: {},
        });
        return true;
      });
    },
  };
}
