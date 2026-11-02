import { createHash } from 'node:crypto';

import {
  AuditEntryIdSchema,
  newId,
  PlatformSchema,
  SalesFeedCapabilitySchema,
  SalesFeedErrorKindSchema,
  type Platform,
} from '@nirvana/contracts';
import {
  decryptSecret,
  encryptSecret,
  eq,
  keyVersionOf,
  schema,
  withAdmin,
  type Database,
  type EncryptionKey,
} from '@nirvana/db';
import { z } from 'zod';

import type { SalesFeedKeyStore, StoredSalesFeedKey } from '../../domain/sales-feed';

const table = schema.salesFeedCredentials;
type Row = typeof table.$inferSelect;

/** The associated data a key is sealed with: a ciphertext copied to another row, or to the AI keys, does not open. */
export const salesFeedKeyContext = (platform: Platform): string => `sales_feed:${platform}`;

/** Enough to tell two keys apart in `audit_log`, nothing usable: 8 hex characters of its SHA-256. */
function fingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

const RowSchema = z.object({
  platform: PlatformSchema,
  state: z.enum(['connected', 'needs_reconnect']),
  capabilities: z.array(SalesFeedCapabilitySchema),
  lastErrorKind: SalesFeedErrorKindSchema.nullable(),
});

/**
 * `sales_feed_credentials` through the admin role (the migration revokes it from `nirvana_app`), keys sealed with
 * CREDENTIALS_ENCRYPTION_KEYS like the AI keys (ADR 0016 § 3, ADR 0050 § 4). A row no listed key opens reads as a key
 * to connect again, its ciphertext untouched so that putting the old encryption key back recovers it.
 */
export function createSalesFeedKeyStore(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): SalesFeedKeyStore {
  function toStored(row: Row): StoredSalesFeedKey {
    const parsed = RowSchema.parse(row);
    let key: string | null;
    try {
      key = decryptSecret(row.keyCiphertext, keys, salesFeedKeyContext(parsed.platform));
    } catch {
      key = null;
    }
    return {
      platform: parsed.platform,
      key,
      state: key === null ? 'needs_reconnect' : parsed.state,
      capabilities: parsed.capabilities,
      lastErrorKind: key === null ? 'unauthorized' : parsed.lastErrorKind,
      verifiedAt: row.verifiedAt,
    };
  }

  return {
    async find(platform) {
      const [row] = await withAdmin(adminDb, (tx) =>
        tx.select().from(table).where(eq(table.platform, platform)),
      );
      return row === undefined ? null : toStored(row);
    },

    async list() {
      const rows = await withAdmin(adminDb, (tx) => tx.select().from(table));
      return rows.map(toStored);
    },

    async save(platform, key, capabilities, at, by) {
      const sealed = encryptSecret(key, keys, salesFeedKeyContext(platform));
      const values = {
        keyCiphertext: sealed,
        keyVersion: keyVersionOf(sealed),
        state: 'connected',
        capabilities: [...capabilities],
        lastErrorKind: null,
        verifiedAt: at,
        updatedAt: at,
      };
      await withAdmin(adminDb, async (tx) => {
        const [before] = await tx
          .select({ platform: table.platform })
          .from(table)
          .where(eq(table.platform, platform))
          .for('update');
        await tx
          .insert(table)
          .values({ platform, ...values })
          .onConflictDoUpdate({ target: table.platform, set: values });
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: by.userId,
          ip: by.ip,
          action: before === undefined ? 'sales_feed_key.connected' : 'sales_feed_key.replaced',
          entity: 'sales_feed_credential',
          entityId: platform,
          details: { platform, fingerprint: fingerprint(key), capabilities },
        });
      });
    },

    markState(platform, state, lastErrorKind) {
      return withAdmin(adminDb, async (tx) => {
        const [before] = await tx
          .select({ state: table.state, lastErrorKind: table.lastErrorKind })
          .from(table)
          .where(eq(table.platform, platform))
          .for('update');
        if (before === undefined) return null;
        await tx
          .update(table)
          .set({ state, lastErrorKind, updatedAt: new Date() })
          .where(eq(table.platform, platform));
        return {
          state: z.enum(['connected', 'needs_reconnect']).parse(before.state),
          lastErrorKind: SalesFeedErrorKindSchema.nullable().parse(before.lastErrorKind),
        };
      });
    },

    remove(platform, by) {
      return withAdmin(adminDb, async (tx) => {
        const removed = await tx
          .delete(table)
          .where(eq(table.platform, platform))
          .returning({ platform: table.platform });
        if (removed.length === 0) return false;
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: by.userId,
          ip: by.ip,
          action: 'sales_feed_key.disconnected',
          entity: 'sales_feed_credential',
          entityId: platform,
          details: { platform },
        });
        return true;
      });
    },
  };
}
