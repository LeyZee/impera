import { sql, type SQL } from 'drizzle-orm';
import { boolean, check, index, pgPolicy, pgTable, text, unique } from 'drizzle-orm/pg-core';

import { user } from './auth';
import { id, timestampTz, updatedAt } from './columns';

/*
 * The game's facts (ADR 0104 § 12 to § 20) and an account's own preferences. Both hang on the account (`user`), not
 * on a creator: a chatter's gains follow him across the creators he works for, and the creator's badges (ADR 0107)
 * add their kinds and policies to the same table.
 */

const currentUser: SQL = sql`nullif(current_setting('app.user_id', true), '')`;
const currentScope: SQL = sql`nullif(current_setting('app.team_scope', true), '')`;
const notCreatorAccount: SQL = sql`current_setting('app.account_role', true) is distinct from 'creator'`;

/**
 * What an account chose for itself. No row means the defaults (sounds on). Each account reads and writes its own row
 * alone, a chatter as a creator; nothing is ever deleted but with the account.
 */
export const userPreferences = pgTable(
  'user_preferences',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    soundsEnabled: boolean('sounds_enabled').notNull().default(true),
    updatedAt: updatedAt(),
  },
  (t) => [
    pgPolicy('own_read', { for: 'select', using: sql`${t.userId} = ${currentUser}` }),
    pgPolicy('own_insert', { for: 'insert', withCheck: sql`${t.userId} = ${currentUser}` }),
    pgPolicy('own_update', {
      for: 'update',
      using: sql`${t.userId} = ${currentUser}`,
      withCheck: sql`${t.userId} = ${currentUser}`,
    }),
  ],
);

/** The kinds a chatter earns (ADR 0104 § 12 and § 15). `tier` is one row a fortnight and threshold (`scope_key`). */
export const REWARD_GAIN_KINDS = [
  'tier',
  'first_sale',
  'day_record',
  'fortnight_record',
  'fortnight_on_time',
  'streak_5',
  'streak_10',
  'streak_25',
  'ten_ppv_shift',
] as const;

/**
 * A gain: something an account earned, once. Written by the end-of-shift job alone (`withAdmin`), replayable thanks
 * to the unique key: `scope_key` is empty for what is earned once in a life, and names the fortnight and the
 * threshold for a tier. A gain is never deleted nor taken back (§ 15). The account reads its own and marks its
 * reveal played (`revealed_at`, the only column the application may change); the owner and the managers read the
 * team's (§ 20). No amount lives here: the game never touches pay (§ 17).
 */
export const rewardGains = pgTable(
  'reward_gains',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    kind: text('kind').notNull(),
    scopeKey: text('scope_key').notNull().default(''),
    earnedAt: timestampTz('earned_at').notNull(),
    revealedAt: timestampTz('revealed_at'),
  },
  (t) => [
    unique('reward_gains_once').on(t.userId, t.kind, t.scopeKey),
    index('reward_gains_user_idx').on(t.userId, t.earnedAt),
    check(
      'reward_gains_kind_check',
      sql`${t.kind} in (${sql.raw(REWARD_GAIN_KINDS.map((kind) => `'${kind}'`).join(', '))})`,
    ),
    check('reward_gains_scope_check', sql`(${t.kind} = 'tier') = (${t.scopeKey} <> '')`),
    check('reward_gains_reveal_check', sql`${t.revealedAt} is null or ${t.revealedAt} >= ${t.earnedAt}`),
    pgPolicy('own_read', { for: 'select', using: sql`${t.userId} = ${currentUser}` }),
    pgPolicy('team_read', {
      for: 'select',
      using: sql`${notCreatorAccount} and ${currentScope} in ('owner', 'agency')`,
    }),
    pgPolicy('own_reveal', {
      for: 'update',
      using: sql`${t.userId} = ${currentUser}`,
      withCheck: sql`${t.userId} = ${currentUser}`,
    }),
  ],
);
