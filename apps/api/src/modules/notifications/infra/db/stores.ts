import { randomUUID } from 'node:crypto';

import { NotificationPreferencesSchema, type NotificationPreferences } from '@nirvana/contracts';
import {
  and,
  decryptSecret,
  encryptSecret,
  eq,
  keyVersionOf,
  schema,
  sql,
  withAdmin,
  withMember,
  type Database,
  type EncryptionKey,
} from '@nirvana/db';

import type { PreferencesStore, ServerKey, ServerKeyStore, SubscriptionStore } from '../../domain/ports';
import { generateVapidKeys } from '../web-push';

/** The associated data the private key is sealed with: a ciphertext copied to another secret's row does not open. */
const SEAL_CONTEXT = 'push:vapid';

/**
 * `push_server_keys` through the admin role only (revoked from `nirvana_app`). The first call makes the pair under an
 * advisory lock, so the API and the worker starting together keep a single one. Kept in memory once read: the key
 * only changes by a renewal, which restarts nothing but ends the subscriptions made with the old one.
 */
export function createServerKeyStore(adminDb: Database, keys: readonly EncryptionKey[]): ServerKeyStore {
  let cached: ServerKey | null = null;
  return {
    async current() {
      if (cached !== null) return cached;
      const loaded = await withAdmin(adminDb, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('notifications.server_key', 0))`);
        const [row] = await tx
          .select()
          .from(schema.pushServerKeys)
          .where(sql`${schema.pushServerKeys.retiredAt} is null`)
          .limit(1);
        if (row !== undefined) {
          return {
            id: row.id,
            publicKey: row.publicKey,
            privateKey: Buffer.from(decryptSecret(row.privateKeyCiphertext, keys, SEAL_CONTEXT), 'base64url'),
          };
        }
        const pair = generateVapidKeys();
        const sealed = encryptSecret(pair.privateKey.toString('base64url'), keys, SEAL_CONTEXT);
        const id = randomUUID();
        await tx.insert(schema.pushServerKeys).values({
          id,
          publicKey: pair.publicKey,
          privateKeyCiphertext: sealed,
          keyVersion: keyVersionOf(sealed),
        });
        return { id, publicKey: pair.publicKey, privateKey: pair.privateKey };
      });
      cached = loaded;
      return loaded;
    },
  };
}

const subscriptions = schema.pushSubscriptions;

/**
 * `push_subscriptions`. Reads and deletes run as the account (`withMember`, RLS: its own rows only). Saving runs as
 * admin with the account taken from the session, never from the body: an endpoint is unique, and a device another
 * account used before (signed out without being forgotten, a shared phone) must move to this one, a row RLS hides.
 */
export function createSubscriptionStore(db: Database, adminDb: Database): SubscriptionStore {
  return {
    async save(userId, input, serverKeyId) {
      await withAdmin(adminDb, (tx) =>
        tx
          .insert(subscriptions)
          .values({
            id: randomUUID(),
            userId,
            endpoint: input.endpoint,
            p256dh: input.keys.p256dh,
            auth: input.keys.auth,
            serverKeyId,
          })
          .onConflictDoUpdate({
            target: subscriptions.endpoint,
            set: {
              userId,
              p256dh: input.keys.p256dh,
              auth: input.keys.auth,
              serverKeyId,
              seenAt: sql`now()`,
            },
          }),
      );
    },
    async remove(userId, endpoint) {
      await withMember(db, userId, (tx) =>
        tx
          .delete(subscriptions)
          .where(and(eq(subscriptions.userId, userId), eq(subscriptions.endpoint, endpoint))),
      );
    },
    listFor(userId, serverKeyId) {
      return withMember(db, userId, (tx) =>
        tx
          .select({
            id: subscriptions.id,
            endpoint: subscriptions.endpoint,
            p256dh: subscriptions.p256dh,
            auth: subscriptions.auth,
            serverKeyId: subscriptions.serverKeyId,
          })
          .from(subscriptions)
          .where(and(eq(subscriptions.userId, userId), eq(subscriptions.serverKeyId, serverKeyId))),
      );
    },
    async drop(userId, id) {
      await withMember(db, userId, (tx) =>
        tx.delete(subscriptions).where(and(eq(subscriptions.userId, userId), eq(subscriptions.id, id))),
      );
    },
    async touch(userId, id) {
      await withMember(db, userId, (tx) =>
        tx
          .update(subscriptions)
          .set({ seenAt: sql`now()` })
          .where(and(eq(subscriptions.userId, userId), eq(subscriptions.id, id))),
      );
    },
  };
}

const preferences = schema.notificationPreferences;

export function createPreferencesStore(db: Database): PreferencesStore {
  return {
    async get(userId) {
      const [row] = await withMember(db, userId, (tx) =>
        tx.select().from(preferences).where(eq(preferences.userId, userId)),
      );
      if (row === undefined) return null;
      return NotificationPreferencesSchema.parse({
        quietHours: { startMinute: row.quietStartMinute, endMinute: row.quietEndMinute },
        dailyCap: row.dailyCap,
      });
    },
    async put(userId, value: NotificationPreferences) {
      const set = {
        quietStartMinute: value.quietHours.startMinute,
        quietEndMinute: value.quietHours.endMinute,
        dailyCap: value.dailyCap,
        updatedAt: sql`now()`,
      };
      await withMember(db, userId, (tx) =>
        tx
          .insert(preferences)
          .values({ userId, ...set })
          .onConflictDoUpdate({ target: preferences.userId, set }),
      );
    },
  };
}
