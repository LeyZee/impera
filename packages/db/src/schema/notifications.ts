import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  pgPolicy,
  pgTable,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, timestampTz, updatedAt } from './columns';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;

/**
 * Push notifications (CR-01, ADR 0042 § 7).
 *
 * `push_server_keys`: the server's VAPID key pair, made at the first start and never typed by anyone (ADR 0016). The
 * private key is sealed with CREDENTIALS_ENCRYPTION_KEYS; out of RLS and revoked from `nirvana_app` like the other
 * secrets, read through `withAdmin` only. One row is current (`retired_at` null); renewing it from Réglages retires the
 * row and makes every device subscribe again at its next opening.
 */
export const pushServerKeys = pgTable('push_server_keys', {
  id: uuid('id').primaryKey(),
  /** Uncompressed P-256 public key (65 bytes), what the page passes to `pushManager.subscribe`. */
  publicKey: bytea('public_key').notNull(),
  privateKeyCiphertext: bytea('private_key_ciphertext').notNull(),
  keyVersion: text('key_version').notNull(),
  createdAt: createdAt(),
  retiredAt: timestampTz('retired_at'),
});

/**
 * One row per device that accepted notifications, under its account: each account reads and writes only its own
 * (`withMember`). The endpoint is unique: a device that changes hands (another account signs in) moves with it. The
 * keys are the device's, public by nature; `server_key_id` says which server key it was made with.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique('push_subscriptions_endpoint_unique'),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    serverKeyId: uuid('server_key_id')
      .notNull()
      .references(() => pushServerKeys.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    /** Last time the page confirmed it (each opening), or a send went through. */
    seenAt: timestampTz('seen_at').notNull().defaultNow(),
  },
  (t) => [
    index('push_subscriptions_user_idx').on(t.userId),
    pgPolicy('own_rows', {
      for: 'all',
      using: sql`${t.userId} = ${currentUser}`,
      withCheck: sql`${t.userId} = ${currentUser}`,
    }),
  ],
);

/** An account's settings in Moi › Notifications; no row means the defaults (22 h – 8 h, 6 a day). */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    quietStartMinute: smallint('quiet_start_minute').notNull(),
    quietEndMinute: smallint('quiet_end_minute').notNull(),
    dailyCap: integer('daily_cap').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'notification_preferences_minutes_check',
      sql`${t.quietStartMinute} between 0 and 1439 and ${t.quietEndMinute} between 0 and 1439`,
    ),
    check('notification_preferences_cap_check', sql`${t.dailyCap} between 1 and 30`),
    pgPolicy('own_rows', {
      for: 'all',
      using: sql`${t.userId} = ${currentUser}`,
      withCheck: sql`${t.userId} = ${currentUser}`,
    }),
  ],
);
