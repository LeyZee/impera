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
const salesFeedKeyContext = (platform: Platform): string => `sales_feed:${platform}`;

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

export interface ResealReport {
  readonly total: number;
  readonly rewritten: number;
  /** Platforms whose key no listed encryption key opens: left as they are, so an older key put back recovers them. */
  readonly unreadable: readonly string[];
}

/**
 * After a rotation of CREDENTIALS_ENCRYPTION_KEYS, re-seals every sales feed key with the newest one, in one
 * transaction (runbooks/rotate-secrets.md). With `dryRun`, only counts what opens (`pnpm ops:check-keys`): nothing is
 * written, nothing decrypted leaves this function. Re-running it is a no-op.
 */
export function resealSalesFeedKeys(
  adminDb: Database,
  keys: readonly EncryptionKey[],
  dryRun = false,
): Promise<ResealReport> {
  const current = keys[0]?.version;
  if (current === undefined) throw new Error('CREDENTIALS_ENCRYPTION_KEYS est vide');
  return adminDb.transaction(async (tx) => {
    const query = tx.select({ platform: table.platform, sealed: table.keyCiphertext }).from(table);
    const rows = dryRun ? await query : await query.for('update');
    let rewritten = 0;
    const unreadable: string[] = [];
    for (const row of rows) {
      const platform = PlatformSchema.parse(row.platform);
      let key: string;
      try {
        key = decryptSecret(row.sealed, keys, salesFeedKeyContext(platform));
      } catch {
        unreadable.push(platform);
        continue;
      }
      if (dryRun || keyVersionOf(row.sealed) === current) continue;
      const sealed = encryptSecret(key, keys, salesFeedKeyContext(platform));
      await tx
        .update(table)
        .set({ keyCiphertext: sealed, keyVersion: keyVersionOf(sealed) })
        .where(eq(table.platform, platform));
      rewritten += 1;
    }
    if (rewritten > 0) {
      await tx.insert(schema.auditLog).values({
        id: newId(AuditEntryIdSchema),
        userId: null,
        ip: null,
        action: 'sales_feed_key.reencrypted',
        entity: 'sales_feed_credential',
        entityId: null,
        details: { rewritten, keyVersion: current },
      });
    }
    return { total: rows.length, rewritten, unreadable };
  });
}
