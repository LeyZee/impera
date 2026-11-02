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
  unique,
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

/**
 * Every notification asked for an account, once (CR-01): the unique key (account, reason, object) makes a replayed
 * job a no-op, and the row is written with the decision in one transaction. It is also what the rules count: the
 * capped ones rung today in the account's day (`local_day`), the sales rung in the last two minutes, the ones held
 * until the end of the quiet hours (`hold_until`) that the recap gathers. Each account reads only its own.
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    objectKey: text('object_key').notNull(),
    decision: text('decision').notNull(),
    /** The account's day when it was decided (`YYYY-MM-DD`, in its zone): the cap counts per day. */
    localDay: text('local_day').notNull(),
    holdUntil: timestampTz('hold_until'),
    title: text('title').notNull(),
    url: text('url').notNull(),
    decidedAt: timestampTz('decided_at').notNull().defaultNow(),
  },
  (t) => [
    unique('notification_deliveries_once').on(t.userId, t.reason, t.objectKey),
    index('notification_deliveries_user_decided_idx').on(t.userId, t.decidedAt),
    check(
      'notification_deliveries_decision_check',
      sql`${t.decision} in ('rang', 'held', 'grouped', 'silent', 'recapped')`,
    ),
    check(
      'notification_deliveries_reason_check',
      sql`${t.reason} in ('sale', 'own_shift_start', 'reminder', 'routine', 'streak', 'team')`,
    ),
    pgPolicy('own_rows', {
      for: 'all',
      using: sql`${t.userId} = ${currentUser}`,
      withCheck: sql`${t.userId} = ${currentUser}`,
    }),
  ],
);
