import {
  TelegramBotStateSchema,
  TelegramChatKindSchema,
  TelegramDeliveryStatusSchema,
  TelegramErrorKindSchema,
  TelegramMembershipSchema,
  TelegramTopicSchema,
} from '@nirvana/contracts';
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { createdAt, enumCheck, enumText, id, timestampTz, updatedAt } from './columns';
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
