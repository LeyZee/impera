import {
  AuditEntryIdSchema,
  JOB_MAX_ATTEMPTS,
  newId,
  PlatformSchema,
  type JobPayload,
  type Platform,
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

import type { SalesFeedJobs, SalesFeedWebhookStore, StoredWebhook } from '../../domain/sales-feed';

import type { ResealReport } from './sales-feed-keys';

const webhooks = schema.salesFeedWebhooks;
const deliveries = schema.salesFeedDeliveries;
type Row = typeof webhooks.$inferSelect;

/** The associated data a secret is sealed with: a ciphertext copied to the key's row does not open. */
const webhookSecretContext = (platform: Platform): string => `sales_feed_webhook:${platform}`;

/**
 * `sales_feed_webhooks` and its inbox through the admin role (the migration revokes both from `nirvana_app`), the
 * secret sealed with CREDENTIALS_ENCRYPTION_KEYS like the key (ADR 0050 § 4). A secret no listed key opens reads as
 * `null`: every delivery is refused until the webhook is registered again, the cursor still reads every minute.
 */
export function createSalesFeedWebhookStore(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): SalesFeedWebhookStore {
  function toStored(row: Row): StoredWebhook {
    const platform = PlatformSchema.parse(row.platform);
    let secret: string | null;
    try {
      secret = decryptSecret(row.secretCiphertext, keys, webhookSecretContext(platform));
    } catch {
      secret = null;
    }
    return {
      platform,
      platformWebhookId: row.platformWebhookId,
      secret,
      createdAt: row.createdAt,
      lastDeliveryAt: row.lastDeliveryAt,
      lastRejectedAt: row.lastRejectedAt,
    };
  }

  return {
    async find(platform) {
      const [row] = await withAdmin(adminDb, (tx) =>
        tx.select().from(webhooks).where(eq(webhooks.platform, platform)),
      );
      return row === undefined ? null : toStored(row);
    },

    async save(platform, created, url, at, by) {
      const sealed = encryptSecret(created.secret, keys, webhookSecretContext(platform));
      const values = {
        platformWebhookId: created.platformWebhookId,
        secretCiphertext: sealed,
        keyVersion: keyVersionOf(sealed),
        url,
        lastDeliveryAt: null,
        lastRejectedAt: null,
        createdAt: at,
      };
      await withAdmin(adminDb, async (tx) => {
        await tx
          .insert(webhooks)
          .values({ platform, ...values })
          .onConflictDoUpdate({ target: webhooks.platform, set: values });
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: by.userId,
          ip: by.ip,
          action: 'sales_feed_webhook.registered',
          entity: 'sales_feed_webhook',
          entityId: platform,
          // The platform's id and the address: never the secret.
          details: { platform, platformWebhookId: created.platformWebhookId, url },
        });
      });
    },

    remove(platform, by) {
      return withAdmin(adminDb, async (tx) => {
        const [removed] = await tx.delete(webhooks).where(eq(webhooks.platform, platform)).returning();
        if (removed === undefined) return null;
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: by.userId,
          ip: by.ip,
          action: 'sales_feed_webhook.removed',
          entity: 'sales_feed_webhook',
          entityId: platform,
          details: { platform, platformWebhookId: removed.platformWebhookId },
        });
        return toStored(removed);
      });
    },

    receive(platform, delivery, at) {
      return withAdmin(adminDb, async (tx) => {
        const inserted = await tx
          .insert(deliveries)
          .values({ platform, ...delivery, receivedAt: at })
          .onConflictDoNothing()
          .returning({ deliveryId: deliveries.deliveryId });
        await tx.update(webhooks).set({ lastDeliveryAt: at }).where(eq(webhooks.platform, platform));
        return inserted.length === 0 ? 'duplicate' : 'new';
      });
    },

    async reject(platform, at) {
      await withAdmin(adminDb, (tx) =>
        // At most one write a minute: a burst of forged deliveries reads the row and writes nothing more.
        tx
          .update(webhooks)
          .set({ lastRejectedAt: at })
          .where(
            and(
              eq(webhooks.platform, platform),
              sql`(${webhooks.lastRejectedAt} is null or ${webhooks.lastRejectedAt} < ${at.toISOString()}::timestamptz - interval '1 minute')`,
            ),
          ),
      );
    },

    async prune(before) {
      const removed = await withAdmin(adminDb, (tx) =>
        tx
          .delete(deliveries)
          .where(sql`${deliveries.receivedAt} < ${before.toISOString()}::timestamptz`)
          .returning({ deliveryId: deliveries.deliveryId }),
      );
      return removed.length;
    },
  };
}

/** After a rotation of CREDENTIALS_ENCRYPTION_KEYS: the webhooks' secrets re-sealed, as `resealSalesFeedKeys` does. */
export function resealSalesFeedWebhookSecrets(
  adminDb: Database,
  keys: readonly EncryptionKey[],
  dryRun = false,
): Promise<ResealReport> {
  const current = keys[0]?.version;
  if (current === undefined) throw new Error('CREDENTIALS_ENCRYPTION_KEYS est vide');
  return adminDb.transaction(async (tx) => {
    const query = tx
      .select({ platform: webhooks.platform, sealed: webhooks.secretCiphertext })
      .from(webhooks);
    const rows = dryRun ? await query : await query.for('update');
    let rewritten = 0;
    const unreadable: string[] = [];
    for (const row of rows) {
      const platform = PlatformSchema.parse(row.platform);
      let secret: string;
      try {
        secret = decryptSecret(row.sealed, keys, webhookSecretContext(platform));
      } catch {
        unreadable.push(`${platform} (webhook)`);
        continue;
      }
      if (dryRun || keyVersionOf(row.sealed) === current) continue;
      const sealed = encryptSecret(secret, keys, webhookSecretContext(platform));
      await tx
        .update(webhooks)
        .set({ secretCiphertext: sealed, keyVersion: keyVersionOf(sealed) })
        .where(eq(webhooks.platform, platform));
      rewritten += 1;
    }
    return { total: rows.length, rewritten, unreadable };
  });
}

/**
 * A delivery wakes `connector.read_sales` now. One waiting job at most (`job_key`): ten deliveries in a burst make one
 * read, which records all of them by cursor.
 */
export function createSalesFeedJobs(adminDb: Database): SalesFeedJobs {
  return {
    async readNow() {
      await adminDb.execute(
        sql`select public.enqueue_job(
          task => ${'connector.read_sales'},
          payload => ${'{"woken":true}'}::jsonb,
          queue_name => null,
          run_at => null,
          max_attempts => ${JOB_MAX_ATTEMPTS['connector.read_sales']}::int,
          job_key => ${'connector.read_sales:delivery'},
          job_key_mode => ${'preserve_run_at'}
        )`,
      );
    },
    async recheckLater(platform, from, runAt) {
      const payload: JobPayload<'connector.check_sales'> = { recheck: { platform, from } };
      await adminDb.execute(
        sql`select public.enqueue_job(
          task => ${'connector.check_sales'},
          payload => ${JSON.stringify(payload)}::jsonb,
          queue_name => null,
          run_at => ${runAt.toISOString()}::timestamptz,
          max_attempts => ${JOB_MAX_ATTEMPTS['connector.check_sales']}::int,
          job_key => ${`connector.check_sales:${platform}:${from}`},
          job_key_mode => ${'preserve_run_at'}
        )`,
      );
    },
  };
}
