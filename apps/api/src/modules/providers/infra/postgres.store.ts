import { createHash } from 'node:crypto';

import {
  AiProviderSchema,
  AuditEntryIdSchema,
  newId,
  ProviderConnectionStateSchema,
  ProviderErrorKindSchema,
  ProviderFactSchema,
  ProviderSettingsSchema,
  ProviderVoiceSchema,
  type AiProvider,
} from '@impera/contracts';
import {
  and,
  decryptSecret,
  encryptSecret,
  eq,
  keyVersionOf,
  schema,
  sql,
  withAdmin,
  type Database,
  type EncryptionKey,
} from '@impera/db';
import { z } from 'zod';

import type { StoredCredential } from '../domain/credential';
import type { CredentialStore, KeyActor } from '../domain/ports';

const table = schema.providerCredentials;
type Row = typeof table.$inferSelect;

const NOBODY: KeyActor = { userId: null, ip: null };

/**
 * Enough to tell two keys apart in `audit_log` (« la clé a changé le 17 à 22 h, puis le 18 ») without keeping anything
 * usable about either: 8 hex characters of its SHA-256.
 */
export function keyFingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

const StoredStateSchema = ProviderConnectionStateSchema.exclude(['not_connected']);

/** The jsonb and text columns, checked on the way out like any other boundary. */
const RowSchema = z.object({
  provider: AiProviderSchema,
  state: StoredStateSchema,
  facts: z.array(ProviderFactSchema),
  settings: ProviderSettingsSchema,
  voices: z.array(ProviderVoiceSchema),
  lastErrorKind: ProviderErrorKindSchema.nullable(),
});

export interface PostgresStoreDeps {
  /** The admin connection: `provider_credentials` is revoked from the application role (ADR 0016). */
  readonly adminDb: Database;
  /** CREDENTIALS_ENCRYPTION_KEYS, newest first. */
  readonly keys: readonly EncryptionKey[];
  /** A saved key no listed encryption key opens, for the log: once each time a service becomes unreadable. */
  readonly onUnreadable?: (provider: AiProvider) => void;
}

/**
 * Keys sealed with AES-256-GCM, the provider bound as associated data so a ciphertext copied to another row does
 * not open. A row whose key no longer decrypts (an encryption key dropped too early) reads as a key to replace, and
 * its ciphertext is left untouched so that putting the old encryption key back recovers it. The row's version is
 * `updated_at` in milliseconds, always written from here so it round-trips exactly.
 */
export function createPostgresCredentialStore(deps: PostgresStoreDeps): CredentialStore {
  const reported = new Set<AiProvider>();
  function toCredential(row: Row): StoredCredential {
    const parsed = RowSchema.parse(row);
    let key: string | null;
    try {
      key = decryptSecret(row.keyCiphertext, deps.keys, parsed.provider);
      reported.delete(parsed.provider);
    } catch {
      key = null;
      if (!reported.has(parsed.provider)) {
        reported.add(parsed.provider);
        deps.onUnreadable?.(parsed.provider);
      }
    }
    return {
      provider: parsed.provider,
      key,
      keyLabel: row.keyLabel,
      summary: row.summary,
      facts: parsed.facts,
      settings: parsed.settings,
      voices: parsed.voices,
      state: key === null ? 'needs_reconnect' : parsed.state,
      verifiedAt: row.verifiedAt,
      charactersLeft: row.charactersLeft,
      lastErrorKind: key === null ? 'unauthorized' : parsed.lastErrorKind,
      revision: row.updatedAt.getTime(),
    };
  }

  return {
    async find(provider) {
      const rows = await withAdmin(deps.adminDb, (tx) =>
        tx.select().from(table).where(eq(table.provider, provider)),
      );
      const row = rows[0];
      return row === undefined ? null : toCredential(row);
    },
    async list() {
      const rows = await withAdmin(deps.adminDb, (tx) => tx.select().from(table));
      return rows.map(toCredential);
    },
    async save(credential, by = NOBODY) {
      const sealed = encryptSecret(credential.key, deps.keys, credential.provider);
      const values = {
        keyCiphertext: sealed,
        keyVersion: keyVersionOf(sealed),
        keyLabel: credential.keyLabel,
        state: credential.state,
        summary: credential.summary,
        facts: credential.facts,
        settings: credential.settings,
        voices: credential.voices,
        charactersLeft: credential.charactersLeft,
        lastErrorKind: credential.lastErrorKind,
        verifiedAt: credential.verifiedAt,
        updatedAt: new Date(),
      };
      await withAdmin(deps.adminDb, async (tx) => {
        // `xmax = 0` only on a row this statement inserted: connected or replaced, decided by the write itself.
        const [written] = await tx
          .insert(table)
          .values({ provider: credential.provider, ...values })
          .onConflictDoUpdate({ target: table.provider, set: values })
          .returning({ isNew: sql<boolean>`(xmax = 0)` });
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: by.userId,
          ip: by.ip,
          action: written?.isNew === false ? 'provider_key.replaced' : 'provider_key.connected',
          entity: 'provider_credential',
          entityId: credential.provider,
          details: { provider: credential.provider, fingerprint: keyFingerprint(credential.key) },
        });
      });
    },
    async update(credential) {
      const updated = await withAdmin(deps.adminDb, (tx) =>
        tx
          .update(table)
          .set({
            keyLabel: credential.keyLabel,
            state: credential.state,
            summary: credential.summary,
            facts: credential.facts,
            settings: credential.settings,
            voices: credential.voices,
            charactersLeft: credential.charactersLeft,
            lastErrorKind: credential.lastErrorKind,
            verifiedAt: credential.verifiedAt,
            // Strictly later than the version read, even within the same millisecond.
            updatedAt: new Date(Math.max(Date.now(), credential.revision + 1)),
          })
          .where(
            and(eq(table.provider, credential.provider), eq(table.updatedAt, new Date(credential.revision))),
          )
          .returning({ provider: table.provider }),
      );
      return updated.length === 1;
    },
    async remove(provider, by = NOBODY) {
      await withAdmin(deps.adminDb, async (tx) => {
        const removed = await tx
          .delete(table)
          .where(eq(table.provider, provider))
          .returning({ provider: table.provider });
        if (removed.length === 0) return;
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: by.userId,
          ip: by.ip,
          action: 'provider_key.disconnected',
          entity: 'provider_credential',
          entityId: provider,
          details: { provider },
        });
      });
    },
  };
}

interface ResealReport {
  /** Rows re-sealed with the newest key. */
  readonly rewritten: number;
  /** Rows no key of the list opens: left as they are, so an older key put back can still recover them. */
  readonly unreadable: readonly string[];
}

/**
 * After a rotation of CREDENTIALS_ENCRYPTION_KEYS (`v2:<new>,v1:<old>`), re-seals every saved key with the newest
 * one, in one transaction, so that `v1` can then be dropped (runbooks/rotate-secrets.md). Re-running it is a no-op.
 * Only the ciphertext and its version change: the row's state and version (`updated_at`) are kept, so a check
 * running meanwhile still lands. Leaves an `audit_log` line, without any key.
 */
export function resealProviderCredentials(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): Promise<ResealReport> {
  const current = keys[0]?.version;
  if (current === undefined) throw new Error('CREDENTIALS_ENCRYPTION_KEYS est vide');
  return withAdmin(adminDb, async (tx) => {
    const rows = await tx
      .select({ provider: table.provider, sealed: table.keyCiphertext })
      .from(table)
      .for('update');
    let rewritten = 0;
    const unreadable: string[] = [];
    for (const row of rows) {
      if (keyVersionOf(row.sealed) === current) continue;
      let key: string;
      try {
        key = decryptSecret(row.sealed, keys, row.provider);
      } catch {
        unreadable.push(row.provider);
        continue;
      }
      const sealed = encryptSecret(key, keys, row.provider);
      await tx
        .update(table)
        .set({ keyCiphertext: sealed, keyVersion: keyVersionOf(sealed) })
        .where(eq(table.provider, row.provider));
      rewritten += 1;
    }
    if (rewritten === 0 && unreadable.length === 0) return { rewritten, unreadable };
    await tx.insert(schema.auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId: null,
      action: 'provider_key.reencrypted',
      entity: 'provider_credential',
      entityId: null,
      details: { keyVersion: current, rewritten, unreadable },
    });
    return { rewritten, unreadable };
  });
}
