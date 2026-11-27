import {
  ChannelPlannedKindSchema,
  ChannelPostStateSchema,
  ChannelSlotRoleSchema,
  ChannelThemeSchema,
  TelegramBotStateSchema,
  TelegramChatKindSchema,
  TelegramDeliveryStatusSchema,
  TelegramErrorKindSchema,
  TelegramMembershipSchema,
  TelegramTopicSchema,
} from '@impera/contracts';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
  type PgColumn,
} from 'drizzle-orm/pg-core';

import { user } from './auth';
import { createdAt, enumCheck, enumText, id, tenantJobRead, timestampTz, updatedAt } from './columns';
import { creators } from './tenancy';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/**
 * Module `telegram` (ADR 0020). Agency settings, out of RLS and out of reach of `nirvana_app` (the migration
 * revokes it): only `withAdmin` reads or writes them. A bot token is AES-256-GCM sealed with
 * CREDENTIALS_ENCRYPTION_KEYS (crypto.ts, context = `telegram_bot:<id>`).
 */
export const telegramBots = pgTable(
  'telegram_bots',
  {
    id: id(),
    /** Telegram's own numeric id of the bot (the part of the token before the colon). */
    telegramBotId: text('telegram_bot_id').notNull().unique(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    tokenCiphertext: bytea('token_ciphertext').notNull(),
    keyVersion: text('key_version').notNull(),
    state: enumText('state').notNull(),
    /** Next `getUpdates` offset: the last update id seen plus one. */
    updatesOffset: bigint('updates_offset', { mode: 'number' }).notNull().default(0),
    lastPolledAt: timestampTz('last_polled_at'),
    lastPollError: enumText('last_poll_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('telegram_bots', t.state, TelegramBotStateSchema.options),
    enumCheck('telegram_bots', t.lastPollError, TelegramErrorKindSchema.options),
  ],
);

/** A group a bot sits in, discovered from `my_chat_member`, never typed in. */
export const telegramChats = pgTable(
  'telegram_chats',
  {
    id: id(),
    botId: uuid('bot_id')
      .notNull()
      .references(() => telegramBots.id, { onDelete: 'cascade' }),
    /** Signed 64-bit id, kept as text so it never loses precision in JavaScript. */
    telegramChatId: text('telegram_chat_id').notNull(),
    title: text('title').notNull(),
    kind: enumText('kind').notNull(),
    membership: enumText('membership').notNull(),
    canPost: boolean('can_post').notNull(),
    /** Three seconds after the last message, or Telegram's `retry_after` (ADR 0020 §8). */
    nextSendAt: timestampTz('next_send_at'),
    lastSentAt: timestampTz('last_sent_at'),
    lastErrorKind: enumText('last_error_kind'),
    lastErrorAt: timestampTz('last_error_at'),
    discoveredAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('telegram_chats_bot_chat_unique').on(t.botId, t.telegramChatId),
    enumCheck('telegram_chats', t.kind, TelegramChatKindSchema.options),
    enumCheck('telegram_chats', t.membership, TelegramMembershipSchema.options),
    enumCheck('telegram_chats', t.lastErrorKind, TelegramErrorKindSchema.options),
  ],
);

/** Which topic goes to which group, for one creator or for all of them (`creator_id` null). */
export const telegramRoutes = pgTable(
  'telegram_routes',
  {
    id: id(),
    creatorId: uuid('creator_id').references(() => creators.id),
    topic: enumText('topic').notNull(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => telegramChats.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('telegram_routes_unique').on(t.creatorId, t.topic, t.chatId).nullsNotDistinct(),
    enumCheck('telegram_routes', t.topic, TelegramTopicSchema.options),
  ],
);

/**
 * One message to deliver in one group; unique per (source, group) so a replayed scan adds nothing. A group removed
 * from the list (REG-28) leaves its deliveries with `chat_id` null and its title in `chat_title`: the night counts of
 * the Dashboard and the « Dernières alertes » log keep them until the 30-day purge. The unique key keeps Postgres'
 * NULLS DISTINCT on purpose: rows of removed groups never collide, and nothing new is ever written without a group.
 */
export const telegramDeliveries = pgTable(
  'telegram_deliveries',
  {
    id: id(),
    /** The `domain_events` id, or a synthetic key (`digest:<creator>:<day>`, `test:<uuid>`). */
    sourceKey: text('source_key').notNull(),
    /** Null once its group was removed from the list (REG-28): nothing is ever sent to a null group. */
    chatId: uuid('chat_id').references(() => telegramChats.id, { onDelete: 'set null' }),
    /** The group's title when the delivery was written: the log still names a group removed since. */
    chatTitle: text('chat_title').notNull(),
    creatorId: uuid('creator_id').references(() => creators.id),
    topic: enumText('topic').notNull(),
    action: enumText('action').notNull(),
    /** The message an `edit` rewrites or a `reply` answers. */
    parentId: uuid('parent_id'),
    /** What closes the thread later: `conversation:<id>`, `session:<account>`, `kill:<scope>:<id>`. */
    threadKey: text('thread_key'),
    text: text('text').notNull(),
    summary: text('summary').notNull(),
    isSilent: boolean('is_silent').notNull(),
    status: enumText('status').notNull(),
    attempts: integer('attempts').notNull().default(0),
    runAfter: timestampTz('run_after').notNull().defaultNow(),
    telegramMessageId: bigint('telegram_message_id', { mode: 'number' }),
    errorKind: enumText('error_kind'),
    closedBy: text('closed_by'),
    createdAt: createdAt(),
    sentAt: timestampTz('sent_at'),
  },
  (t) => [
    unique('telegram_deliveries_source_chat_unique').on(t.sourceKey, t.chatId),
    index('telegram_deliveries_chat_status_idx').on(t.chatId, t.status, t.runAfter),
    index('telegram_deliveries_thread_idx').on(t.threadKey),
    index('telegram_deliveries_created_idx').on(t.createdAt),
    enumCheck('telegram_deliveries', t.topic, TelegramTopicSchema.options),
    enumCheck('telegram_deliveries', t.action, ['send', 'edit', 'reply']),
    enumCheck('telegram_deliveries', t.status, TelegramDeliveryStatusSchema.options),
    enumCheck('telegram_deliveries', t.errorKind, TelegramErrorKindSchema.options),
  ],
);

/**
 * The module's single row: where the outbox scan stopped (it re-reads a window behind it, ADR 0020 §7) and the
 * version of the routing table (optimistic concurrency of `PUT /routes`).
 */
export const telegramState = pgTable('telegram_state', {
  id: integer('id').primaryKey(),
  scanCursor: timestampTz('scan_cursor').notNull(),
  routesVersion: integer('routes_version').notNull().default(0),
});

/**
 * A topic's settings (ADR 0020 §6), for one creator or for all of them (`creator_id` null), hers winning. Today only
 * the sales topic (CRM-04 lot b): `settings` is `TelegramSaleSettingsSchema`, validated by the module on read and write.
 */
export const telegramSettings = pgTable(
  'telegram_settings',
  {
    id: id(),
    creatorId: uuid('creator_id').references(() => creators.id, { onDelete: 'cascade' }),
    topic: enumText('topic').notNull(),
    settings: jsonb('settings').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('telegram_settings_unique').on(t.creatorId, t.topic).nullsNotDistinct(),
    enumCheck('telegram_settings', t.topic, ['sale']),
  ],
);

/**
 * ADR 0068 § 4: the private chat where a member's own reset link goes, found when they send `/start <code>` to the
 * agency's bot. One per account, used for that link alone; read and written as the admin role only (RLS forced, no
 * policy, revoked from `nirvana_app`).
 */
export const telegramPrivateLinks = pgTable('telegram_private_links', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  botId: uuid('bot_id')
    .notNull()
    .references(() => telegramBots.id, { onDelete: 'cascade' }),
  /** Signed 64-bit id of the private chat, kept as text. */
  telegramChatId: text('telegram_chat_id').notNull(),
  linkedAt: timestampTz('linked_at').notNull().defaultNow(),
});

/**
 * The one-time code a member shows the bot to link their private chat (ADR 0068 § 4): its SHA-256 alone is kept, ten
 * minutes, one per account (a new code replaces the last). Admin role only, as above.
 */
export const telegramLinkCodes = pgTable('telegram_link_codes', {
  codeHash: text('code_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestampTz('expires_at').notNull(),
  createdAt: createdAt(),
});

/**
 * ADR 0057 § 2, ADR 0080: the creator's Telegram channel, one row per creator, the owner's setting stored whole
 * (`TelegramChannelConfigSchema`): the channel, the slots, the preview window, the redirect links. A channel serves one
 * creator at most. Agency settings, read and written as the admin role only (RLS forced, no policy, revoked from
 * `nirvana_app`), like the other telegram tables.
 */
export const telegramChannels = pgTable(
  'telegram_channels',
  {
    creatorId: uuid('creator_id')
      .primaryKey()
      .references(() => creators.id, { onDelete: 'cascade' }),
    /** Null until chosen, or once the group row is gone (REG-28 removes a chat the bot left). */
    chatId: uuid('chat_id').references(() => telegramChats.id, { onDelete: 'set null' }),
    config: jsonb('config').notNull(),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [unique('telegram_channels_chat_unique').on(t.chatId)],
);

/**
 * ADR 0162: the posts of her channel's week, planned on Saturday evening, reviewed by the owner and her, sent at their
 * hour. One row per post; a post removed in the review stays, its replacement points at it. `plan_key` makes the plan
 * replayable (one row per day and window, `:r<n>` for a replacement). `draft` is `ChannelPostDraftSchema`, `review`
 * `ChannelReviewSchema`, both parsed on write and on read. Agency data like the other telegram tables: RLS forced
 * without a policy, revoked from `nirvana_app`; the routes check who asks, then go through `withAdmin`.
 */
/** Her channel's week job, in her creator (ADR 0087 lot c, `withTenantJob`); no account's session sets `app.job`. */
const telegramChannelJob = (creatorId: PgColumn): SQL =>
  sql`${creatorId} = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'telegram_channel'`;

export const telegramChannelPosts = pgTable(
  'telegram_channel_posts',
  {
    id: id(),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => creators.id, { onDelete: 'cascade' }),
    /** Her Monday, and the day of the post, on her calendar. */
    week: date('week', { mode: 'string' }).notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    planKey: text('plan_key').notNull(),
    windowFrom: integer('window_from').notNull(),
    windowUntil: integer('window_until').notNull(),
    at: timestampTz('at').notNull(),
    role: enumText('role').notNull(),
    kind: enumText('kind').notNull(),
    theme: enumText('theme').notNull(),
    draft: jsonb('draft'),
    /** A media of her library (content drops); no foreign key: the media module owns it, a missing one is skipped. */
    mediaId: uuid('media_id'),
    why: text('why'),
    repost: boolean('repost').notNull().default(false),
    state: enumText('state').notNull().default('planned'),
    locked: boolean('locked').notNull().default(false),
    review: jsonb('review'),
    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
    replacesId: uuid('replaces_id'),
    reason: text('reason'),
    /** Telegram's id of the message once sent, and when; the reactions read at 48 h and the link's clicks. */
    telegramMessageId: bigint('telegram_message_id', { mode: 'number' }),
    sentAt: timestampTz('sent_at'),
    reactions: integer('reactions'),
    clicks: integer('clicks'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    enumCheck('telegram_channel_posts', t.role, ChannelSlotRoleSchema.options),
    enumCheck('telegram_channel_posts', t.kind, ChannelPlannedKindSchema.options),
    enumCheck('telegram_channel_posts', t.theme, ChannelThemeSchema.options),
    enumCheck('telegram_channel_posts', t.state, ChannelPostStateSchema.options),
    check('telegram_channel_posts_week_check', sql`extract(isodow from ${t.week}) = 1`),
    check(
      'telegram_channel_posts_window_check',
      sql`${t.windowFrom} between 0 and 1439 and ${t.windowUntil} between ${t.windowFrom} and 1439`,
    ),
    check('telegram_channel_posts_sent_check', sql`(${t.state} = 'sent') = (${t.sentAt} is not null)`),
    unique('telegram_channel_posts_plan_key_unique').on(t.creatorId, t.planKey),
    index('telegram_channel_posts_due_idx').on(t.state, t.at),
    index('telegram_channel_posts_week_idx').on(t.creatorId, t.week),
    // Her week's jobs and the owner's routes, one creator at a time under the app role (`withTenantJob`, job
    // `telegram_channel`): read, planned, changed; never deleted (a removed post stays, its replacement points at it).
    tenantJobRead('telegram_channel_read', t.creatorId, 'telegram_channel'),
    pgPolicy('telegram_channel_insert', { for: 'insert', withCheck: telegramChannelJob(t.creatorId) }),
    pgPolicy('telegram_channel_update', {
      for: 'update',
      using: telegramChannelJob(t.creatorId),
      withCheck: telegramChannelJob(t.creatorId),
    }),
  ],
);
