import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Dashboard users (Better Auth core schema, Drizzle adapter), plus `role` and `creator_ids` on `user`. Out of RLS:
 * the server reads them through `withAdmin`. P0-07 wires Better Auth; if its CLI output (`@better-auth/cli generate`)
 * differs from these tables, the CLI wins and a new migration follows.
 */

const tz = (name: string) => timestamp(name, { withTimezone: true });

export const USER_ROLES = ['owner', 'operator', 'creator'] as const;

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: text('role').notNull().default('operator'),
    creatorIds: uuid('creator_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** A verified authenticator code (ADR 0046 § 1); `false` until the first code is confirmed. */
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('user_role_check', sql`${t.role} in ('owner', 'operator', 'creator')`)],
);

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: tz('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
  /**
   * When the password and the code were last given on this session (ADR 0046 § 3): a sign-in through the code, or the
   * confirmation before a sensitive action. `null` after a sign-in from a trusted device, which asked for no code.
   */
  reauthenticatedAt: tz('reauthenticated_at'),
  /**
   * When the password and the code themselves were last given on this session, never stamped by a passkey gesture:
   * adding a passkey reads it, so a key never adds another key (ADR 0053 § 2).
   */
  codeConfirmedAt: tz('code_confirmed_at'),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: tz('access_token_expires_at'),
  refreshTokenExpiresAt: tz('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: tz('expires_at').notNull(),
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});

/**
 * The authenticator secret and backup codes of an account (Better Auth `two-factor` plugin, ADR 0046 § 1–2). Both are
 * encrypted with the Better Auth secret, never stored in clear. `verified` stays `false` between the activation and
 * the first code; `failed_verification_count` and `locked_until` lock the code after 10 wrong ones in a row.
 */
export const twoFactor = pgTable('two_factor', {
  id: text('id').primaryKey(),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  verified: boolean('verified').notNull().default(true),
  failedVerificationCount: integer('failed_verification_count').notNull().default(0),
  lockedUntil: tz('locked_until'),
});

/**
 * The passkeys of an account (Better Auth `passkey` plugin, ADR 0053): the public part of a key that never leaves the
 * device, its credential id, and the signature counter checked at each gesture. Nothing biometric exists here. `name`
 * is the device it was added from, read from the browser by the server; `last_used_at` is written by the server at
 * each sign-in or confirmation with it, so the owner hears of a sign-in with a key never used before (§ 7).
 */
export const passkey = pgTable(
  'passkey',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull().unique(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    aaguid: text('aaguid'),
    createdAt: tz('created_at').notNull().defaultNow(),
    lastUsedAt: tz('last_used_at'),
  },
  (t) => [index('passkey_user_id_idx').on(t.userId)],
);
