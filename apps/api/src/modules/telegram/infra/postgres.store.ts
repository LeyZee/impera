import {
  AuditEntryIdSchema,
  CreatorIdSchema,
  TelegramBotIdSchema,
  TelegramBotStateSchema,
  TelegramChatIdSchema,
  TelegramChatKindSchema,
  TelegramDeliveryStatusSchema,
  TelegramErrorKindSchema,
  TelegramMembershipSchema,
  TelegramTopicSchema,
  newId,
  type TelegramBotId,
  type TelegramChatId,
  type TelegramRoute,
} from '@nirvana/contracts';
import {
  and,
  decryptSecret,
  encryptSecret,
  eq,
  inArray,
  keyVersionOf,
  schema,
  sql,
  withAdmin,
  type Database,
  type EncryptionKey,
  type Transaction,
} from '@nirvana/db';
import { z } from 'zod';

import { SCANNED_EVENT_TYPES } from '../domain/classify';
import type {
  BotRecord,
  BotsStore,
  ChatRecord,
  DeliveriesStore,
  DeliveryRecord,
  LoggedDelivery,
  NewDelivery,
  ThreadRoot,
} from '../domain/ports';
import { TOPIC_RANK } from '../domain/render';

import { toScannedEvent } from './events';

const bots = schema.telegramBots;
const chats = schema.telegramChats;
const routes = schema.telegramRoutes;
const deliveries = schema.telegramDeliveries;
const state = schema.telegramState;

export interface TelegramStoreDeps {
  /** The admin connection: the module's tables are revoked from the application role (ADR 0020 §4). */
  readonly adminDb: Database;
  /** CREDENTIALS_ENCRYPTION_KEYS, newest first. */
  readonly keys: readonly EncryptionKey[];
}

/** The associated data of a sealed token: a ciphertext copied to another bot does not open. */
const tokenContext = (id: string): string => `telegram_bot:${id}`;

const ErrorKindColumn = TelegramErrorKindSchema.nullable();

function toChat(row: typeof chats.$inferSelect): ChatRecord {
  return {
    id: TelegramChatIdSchema.parse(row.id),
    botId: TelegramBotIdSchema.parse(row.botId),
    telegramChatId: row.telegramChatId,
    title: row.title,
    kind: TelegramChatKindSchema.parse(row.kind),
    membership: TelegramMembershipSchema.parse(row.membership),
    canPost: row.canPost,
    nextSendAt: row.nextSendAt,
    lastSentAt: row.lastSentAt,
    lastErrorKind: ErrorKindColumn.parse(row.lastErrorKind),
  };
}

const ActionSchema = z.enum(['send', 'edit', 'reply']);

/** A delivery of a group still in the list: the queue and the threads only ever read those. */
function toDelivery(row: typeof deliveries.$inferSelect): DeliveryRecord {
  return { ...toLogged(row), chatId: TelegramChatIdSchema.parse(row.chatId) };
}

/** A delivery as the log reads it: its group may have been removed since (REG-28), its title stays. */
function toLogged(row: typeof deliveries.$inferSelect): LoggedDelivery {
  return {
    id: row.id,
    sourceKey: row.sourceKey,
    chatId: row.chatId === null ? null : TelegramChatIdSchema.parse(row.chatId),
    chatTitle: row.chatTitle,
    creatorId: row.creatorId === null ? null : CreatorIdSchema.parse(row.creatorId),
    topic: TelegramTopicSchema.parse(row.topic),
    action: ActionSchema.parse(row.action),
    parentId: row.parentId,
    threadKey: row.threadKey,
    text: row.text,
    summary: row.summary,
    isSilent: row.isSilent,
    closedBy: row.closedBy,
    status: TelegramDeliveryStatusSchema.parse(row.status),
    attempts: row.attempts,
    telegramMessageId: row.telegramMessageId,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  };
}

async function insertDeliveries(
  tx: Transaction,
  rows: readonly NewDelivery[],
  now: Date,
): Promise<readonly TelegramChatId[]> {
  if (rows.length === 0) return [];
  // Each delivery keeps its group's title: the log still names it once the group is removed (REG-28).
  // KEY SHARE orders this against removeChat's FOR UPDATE: either these rows exist before the removal
  // (which then closes them as chat_removed) or the group is already gone and its rows are skipped.
  const titles = new Map(
    (
      await tx
        .select({ id: chats.id, title: chats.title })
        .from(chats)
        .where(inArray(chats.id, [...new Set(rows.map((row) => row.chatId))]))
        .for('key share')
    ).map((chat) => [chat.id, chat.title]),
  );
  const values = rows.flatMap((row) => {
    const chatTitle = titles.get(row.chatId);
    return chatTitle === undefined
      ? []
      : [
          {
            id: newId(z.uuid()),
            ...row,
            chatTitle,
            status: 'pending' as const,
            runAfter: now,
            createdAt: now,
          },
        ];
  });
  if (values.length === 0) return [];
  const inserted = await tx
    .insert(deliveries)
    .values(values)
    .onConflictDoNothing({ target: [deliveries.sourceKey, deliveries.chatId] })
    .returning({ chatId: deliveries.chatId });
  return [
    ...new Set(
      inserted.flatMap((row) => (row.chatId === null ? [] : [TelegramChatIdSchema.parse(row.chatId)])),
    ),
  ];
}

async function enqueueFlushIn(
  tx: Transaction | Database,
  chatId: TelegramChatId,
  runAt: Date,
): Promise<void> {
  // One pending flush per group: a new one replaces it, always computed from the full state of the group.
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'telegram.flush_chat',
      payload => ${JSON.stringify({ chatId })}::jsonb,
      queue_name => ${`telegram-chat:${chatId}`},
      run_at => ${runAt.toISOString()}::timestamptz,
      max_attempts => 10,
      job_key => ${`telegram.flush:${chatId}`},
      job_key_mode => 'replace'
    )`,
  );
}

export interface ResealReport {
  /** Tokens re-sealed with the newest key. */
  readonly rewritten: number;
  /** Bots (`@username`) whose token no listed key opens: left as is, so an older key put back recovers them. */
  readonly unreadable: readonly string[];
}

/**
 * The module's Postgres store (ADR 0020 §4, §5). Bot tokens are sealed with AES-256-GCM; a token that no longer
 * decrypts (an encryption key dropped too early) reads as `null`, its ciphertext untouched so that putting the old
 * key back recovers it.
 */
export function createPostgresTelegramStore(deps: TelegramStoreDeps): {
  readonly bots: BotsStore;
  readonly deliveries: DeliveriesStore;
  /** Re-seals every token with the newest key (rotation, rotate-secrets.md). */
  readonly resealTokens: () => Promise<ResealReport>;
} {
  const admin = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withAdmin(deps.adminDb, fn);

  function open(row: typeof bots.$inferSelect): string | null {
    try {
      return decryptSecret(row.tokenCiphertext, deps.keys, tokenContext(row.id));
    } catch {
      return null;
    }
  }

  function toBot(row: typeof bots.$inferSelect): BotRecord {
    return {
      id: TelegramBotIdSchema.parse(row.id),
      telegramBotId: row.telegramBotId,
      username: row.username,
      displayName: row.displayName,
      token: open(row),
      state: TelegramBotStateSchema.parse(row.state),
      updatesOffset: row.updatesOffset,
      lastPolledAt: row.lastPolledAt,
    };
  }

  function seal(id: string, token: string): { tokenCiphertext: Buffer; keyVersion: string } {
    const tokenCiphertext = encryptSecret(token, deps.keys, tokenContext(id));
    return { tokenCiphertext, keyVersion: keyVersionOf(tokenCiphertext) };
  }

  const botsStore: BotsStore = {
    async listBots() {
      const rows = await admin((tx) => tx.select().from(bots).orderBy(bots.createdAt));
      return rows.map(toBot);
    },
    async findBot(id) {
      const [row] = await admin((tx) => tx.select().from(bots).where(eq(bots.id, id)));
      return row === undefined ? null : toBot(row);
    },
    async findBotByTelegramId(telegramBotId) {
      const [row] = await admin((tx) => tx.select().from(bots).where(eq(bots.telegramBotId, telegramBotId)));
      return row === undefined ? null : toBot(row);
    },
    async insertBot(bot) {
      await admin((tx) =>
        tx.insert(bots).values({
          id: bot.id,
          telegramBotId: bot.telegramBotId,
          username: bot.username,
          displayName: bot.displayName,
          state: bot.state,
          ...seal(bot.id, bot.token),
        }),
      );
    },
    async replaceToken(id, token, username, displayName) {
      await admin((tx) =>
        tx
          .update(bots)
          .set({
            ...seal(id, token),
            username,
            displayName,
            state: 'active',
            lastPollError: null,
            updatedAt: new Date(),
          })
          .where(eq(bots.id, id)),
      );
    },
    async setBotState(id, botState, error) {
      await admin((tx) =>
        tx
          .update(bots)
          .set({ state: botState, lastPollError: error, updatedAt: new Date() })
          .where(eq(bots.id, id)),
      );
    },
    async applyUpdates(id, batch, polledAt) {
      await admin(async (tx) => {
        for (const migration of batch.migrations) {
          // The old group's row takes the new id, keeping its routes; a row already created for the new id goes.
          await tx
            .delete(chats)
            .where(and(eq(chats.botId, id), eq(chats.telegramChatId, migration.toChatId)));
          await tx
            .update(chats)
            .set({ telegramChatId: migration.toChatId, kind: 'supergroup', updatedAt: polledAt })
            .where(and(eq(chats.botId, id), eq(chats.telegramChatId, migration.fromChatId)));
        }
        for (const chat of batch.chats) {
          await tx
            .insert(chats)
            .values({ id: newId(TelegramChatIdSchema), botId: id, ...chat })
            .onConflictDoUpdate({
              target: [chats.botId, chats.telegramChatId],
              set: {
                title: chat.title,
                kind: chat.kind,
                membership: chat.membership,
                canPost: chat.canPost,
                // Back in the group: the last failure no longer applies.
                ...(chat.membership === 'member' ? { lastErrorKind: null, lastErrorAt: null } : {}),
                updatedAt: polledAt,
              },
            });
        }
        for (const renamed of batch.titles) {
          await tx
            .update(chats)
            .set({ title: renamed.title, updatedAt: polledAt })
            .where(and(eq(chats.botId, id), eq(chats.telegramChatId, renamed.telegramChatId)));
        }
        await tx
          .update(bots)
          .set({
            updatesOffset: batch.nextOffset,
            lastPolledAt: polledAt,
            state: 'active',
            lastPollError: null,
            updatedAt: polledAt,
          })
          .where(eq(bots.id, id));
      });
    },
    async removeBot(id) {
      await admin(async (tx) => {
        // Cascades to its groups, their routes and deliveries; the routing version moves so open screens reload.
        await tx.delete(bots).where(eq(bots.id, id));
        await tx
          .update(state)
          .set({ routesVersion: sql`${state.routesVersion} + 1` })
          .where(eq(state.id, 1));
      });
    },
    async removeChat(id, mayRemove, userId) {
      return admin(async (tx) => {
        const [row] = await tx
          .select({ membership: chats.membership, title: chats.title })
          .from(chats)
          .where(eq(chats.id, id))
          .for('update');
        if (row === undefined) return 'missing';
        if (!mayRemove(TelegramMembershipSchema.parse(row.membership))) return 'refused';
        // What still waited for the group never leaves: said so in the log. A send under way may have gone out.
        await tx
          .update(deliveries)
          .set({ status: 'failed', errorKind: 'chat_removed' })
          .where(and(eq(deliveries.chatId, id), eq(deliveries.status, 'pending')));
        await tx
          .update(deliveries)
          .set({ status: 'unknown', errorKind: 'chat_removed' })
          .where(and(eq(deliveries.chatId, id), eq(deliveries.status, 'sending')));
        // Cascades to its routes; its deliveries stay, `chat_id` null, for the night counts and the log until the
        // purge. The routing version moves so open screens reload.
        await tx.delete(chats).where(eq(chats.id, id));
        await tx
          .update(state)
          .set({ routesVersion: sql`${state.routesVersion} + 1` })
          .where(eq(state.id, 1));
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId,
          action: 'telegram_chat.remove',
          entity: 'telegram_chat',
          entityId: id,
          details: { membership: row.membership },
        });
        return 'removed';
      });
    },
    async listChats() {
      const rows = await admin((tx) => tx.select().from(chats).orderBy(chats.discoveredAt));
      return rows.map(toChat);
    },
    async findChat(id) {
      const [row] = await admin((tx) => tx.select().from(chats).where(eq(chats.id, id)));
      return row === undefined ? null : toChat(row);
    },
    async updateChat(id, patch) {
      await admin((tx) =>
        tx
          .update(chats)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(chats.id, id)),
      );
    },
    async listRoutes() {
      return admin(async (tx) => {
        const rows = await tx.select().from(routes).orderBy(routes.createdAt);
        const [current] = await tx
          .select({ version: state.routesVersion })
          .from(state)
          .where(eq(state.id, 1));
        return {
          routes: rows.map((row): TelegramRoute => ({
            creatorId: row.creatorId === null ? null : CreatorIdSchema.parse(row.creatorId),
            topic: TelegramTopicSchema.parse(row.topic),
            chatId: TelegramChatIdSchema.parse(row.chatId),
          })),
          version: current?.version ?? 0,
        };
      });
    },
    async replaceRoutes(version, next) {
      return admin(async (tx) => {
        const moved = await tx
          .update(state)
          .set({ routesVersion: version + 1 })
          .where(and(eq(state.id, 1), eq(state.routesVersion, version)))
          .returning({ id: state.id });
        if (moved.length === 0) return false;
        await tx.delete(routes);
        if (next.length > 0) {
          await tx.insert(routes).values(next.map((route) => ({ id: newId(z.uuid()), ...route })));
        }
        return true;
      });
    },
    async listCreators() {
      const rows = await admin((tx) =>
        tx
          .select({
            id: schema.creators.id,
            displayName: schema.creators.displayName,
            timezone: schema.creators.timezone,
          })
          .from(schema.creators)
          .orderBy(schema.creators.createdAt),
      );
      return rows.map((row) => ({ ...row, id: CreatorIdSchema.parse(row.id) }));
    },
    async userName(userId) {
      const [row] = await admin((tx) =>
        tx.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId)),
      );
      return row?.name ?? null;
    },
  };

  const deliveriesStore: DeliveriesStore = {
    async getCursor() {
      const [row] = await admin((tx) =>
        tx.select({ cursor: state.scanCursor }).from(state).where(eq(state.id, 1)),
      );
      return row?.cursor ?? new Date(0);
    },
    async readEvents(since, limit) {
      const table = schema.domainEvents;
      const rows = await admin((tx) =>
        tx
          .select({
            id: table.id,
            creatorId: table.creatorId,
            type: table.type,
            payload: table.payload,
            createdAt: table.createdAt,
          })
          .from(table)
          .where(
            and(
              sql`${table.createdAt} > ${since.toISOString()}::timestamptz`,
              inArray(table.type, [...SCANNED_EVENT_TYPES]),
            ),
          )
          .orderBy(table.createdAt, table.id)
          .limit(limit),
      );
      return rows.flatMap((row) => {
        const event = toScannedEvent(row);
        return event === null ? [] : [event];
      });
    },
    async threadRoots(threadKey) {
      const rows = await admin((tx) =>
        tx
          .select()
          .from(deliveries)
          .where(
            and(
              eq(deliveries.threadKey, threadKey),
              // A removed group gets no edit nor reply.
              sql`${deliveries.chatId} is not null`,
              eq(deliveries.action, 'send'),
              inArray(deliveries.status, ['pending', 'sending', 'sent']),
            ),
          )
          .orderBy(deliveries.createdAt),
      );
      // The latest message of the thread in each group: a new handoff after a resolved one opens a new thread.
      const byChat = new Map<string, ThreadRoot>();
      for (const row of rows.map(toDelivery)) {
        byChat.set(row.chatId, {
          id: row.id,
          chatId: row.chatId,
          creatorId: row.creatorId,
          topic: row.topic,
          text: row.text,
          closedBy: row.closedBy,
        });
      }
      return [...byChat.values()];
    },
    async applyScan(batch) {
      await admin(async (tx) => {
        const now = new Date();
        const touched = await insertDeliveries(tx, batch.deliveries, now);
        await tx
          .update(state)
          .set({ scanCursor: sql`greatest(${state.scanCursor}, ${batch.cursor.toISOString()}::timestamptz)` })
          .where(eq(state.id, 1));
        for (const chatId of touched) await enqueueFlushIn(tx, chatId, now);
      });
    },
    async insertDelivery(delivery, now) {
      return admin(async (tx) => {
        const touched = await insertDeliveries(tx, [delivery], now);
        for (const chatId of touched) await enqueueFlushIn(tx, chatId, now);
        return touched.length > 0;
      });
    },
    async readyFor(chatId, now) {
      const rows = await admin((tx) =>
        tx
          .select()
          .from(deliveries)
          .where(
            and(
              eq(deliveries.chatId, chatId),
              eq(deliveries.status, 'pending'),
              sql`${deliveries.runAfter} <= ${now.toISOString()}::timestamptz`,
            ),
          )
          .orderBy(deliveries.createdAt)
          .limit(200),
      );
      return rows.map(toDelivery).sort((a, b) => TOPIC_RANK[a.topic] - TOPIC_RANK[b.topic]);
    },
    async staleSending(chatId, olderThan) {
      const rows = await admin((tx) =>
        tx
          .select()
          .from(deliveries)
          .where(
            and(
              eq(deliveries.chatId, chatId),
              eq(deliveries.status, 'sending'),
              sql`${deliveries.runAfter} < ${olderThan.toISOString()}::timestamptz`,
            ),
          ),
      );
      return rows.map(toDelivery);
    },
    async markSending(ids) {
      if (ids.length === 0) return;
      // `run_after` doubles as the moment the call started, for `staleSending`.
      await admin((tx) =>
        tx
          .update(deliveries)
          .set({ status: 'sending', attempts: sql`${deliveries.attempts} + 1`, runAfter: new Date() })
          .where(inArray(deliveries.id, [...ids])),
      );
    },
    async markSent(ids, telegramMessageId, sentAt) {
      if (ids.length === 0) return;
      await admin((tx) =>
        tx
          .update(deliveries)
          .set({ status: 'sent', telegramMessageId, sentAt, errorKind: null })
          .where(inArray(deliveries.id, [...ids])),
      );
    },
    async markRetry(ids, runAfter, errorKind) {
      if (ids.length === 0) return;
      await admin((tx) =>
        tx
          .update(deliveries)
          .set({ status: 'pending', runAfter, errorKind })
          .where(inArray(deliveries.id, [...ids])),
      );
    },
    async markDone(ids, status, errorKind) {
      if (ids.length === 0) return;
      await admin((tx) =>
        tx
          .update(deliveries)
          .set({ status, errorKind })
          .where(inArray(deliveries.id, [...ids])),
      );
    },
    async requeue(ids, text, runAfter) {
      await admin(async (tx) => {
        const rows = await tx
          .select()
          .from(deliveries)
          .where(inArray(deliveries.id, [...ids]));
        for (const row of rows) {
          await tx
            .update(deliveries)
            .set({ status: 'pending', runAfter, text: text(row.text) })
            .where(eq(deliveries.id, row.id));
        }
      });
    },
    async parentState(deliveryId) {
      return admin(async (tx) => {
        const [row] = await tx.select().from(deliveries).where(eq(deliveries.id, deliveryId));
        if (row === undefined) return null;
        const status = TelegramDeliveryStatusSchema.parse(row.status);
        let isShared = false;
        if (row.telegramMessageId !== null && row.chatId !== null) {
          const [shared] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(deliveries)
            .where(
              and(
                eq(deliveries.chatId, row.chatId),
                eq(deliveries.telegramMessageId, row.telegramMessageId),
                eq(deliveries.action, 'send'),
              ),
            );
          isShared = (shared?.count ?? 0) > 1;
        }
        return { status, telegramMessageId: row.telegramMessageId, isShared };
      });
    },
    async nextRunAfter(chatId) {
      const [row] = await admin((tx) =>
        tx
          .select({ at: sql<Date | null>`min(${deliveries.runAfter})` })
          .from(deliveries)
          .where(and(eq(deliveries.chatId, chatId), eq(deliveries.status, 'pending'))),
      );
      return row?.at == null ? null : new Date(row.at);
    },
    async setClosedBy(deliveryId, name) {
      await admin((tx) => tx.update(deliveries).set({ closedBy: name }).where(eq(deliveries.id, deliveryId)));
    },
    async enqueueFlush(chatId, runAt) {
      await enqueueFlushIn(deps.adminDb, chatId, runAt);
    },
    async enqueuePoll(botId: TelegramBotId, waitSeconds) {
      await deps.adminDb.execute(
        sql`select public.enqueue_job(
          task => 'telegram.poll_updates',
          payload => ${JSON.stringify({ botId, waitSeconds })}::jsonb,
          queue_name => ${`telegram-bot:${botId}`},
          max_attempts => 1,
          job_key => ${`telegram.poll:${botId}`},
          job_key_mode => 'replace'
        )`,
      );
    },
    async listDeliveries(limit, topic) {
      const rows = await admin((tx) =>
        tx
          .select()
          .from(deliveries)
          .where(topic === null ? undefined : eq(deliveries.topic, topic))
          .orderBy(sql`${deliveries.createdAt} desc`)
          .limit(limit),
      );
      return rows.map(toLogged);
    },
    async countTopics(creatorId, from, to) {
      // One alert sent to two groups counts once: distinct source.
      const rows = await admin((tx) =>
        tx
          .select({
            topic: deliveries.topic,
            count: sql<number>`count(distinct ${deliveries.sourceKey})::int`,
          })
          .from(deliveries)
          .where(
            and(
              eq(deliveries.creatorId, creatorId),
              eq(deliveries.action, 'send'),
              sql`${deliveries.createdAt} >= ${from.toISOString()}::timestamptz`,
              sql`${deliveries.createdAt} < ${to.toISOString()}::timestamptz`,
            ),
          )
          .groupBy(deliveries.topic),
      );
      return Object.fromEntries(rows.map((row) => [TelegramTopicSchema.parse(row.topic), row.count]));
    },
    async purgeBefore(at) {
      const removed = await admin((tx) =>
        tx
          .delete(deliveries)
          .where(sql`${deliveries.createdAt} < ${at.toISOString()}::timestamptz`)
          .returning({ id: deliveries.id }),
      );
      return removed.length;
    },
  };

  async function resealTokens(): Promise<ResealReport> {
    const current = deps.keys[0]?.version;
    if (current === undefined) return { rewritten: 0, unreadable: [] };
    return admin(async (tx) => {
      const rows = await tx
        .select()
        .from(bots)
        .where(sql`${bots.keyVersion} <> ${current}`)
        .for('update');
      let rewritten = 0;
      const unreadable: string[] = [];
      for (const row of rows) {
        const token = open(row);
        // Unreadable with every key given: left as is, so the old key can still be put back.
        if (token === null) {
          unreadable.push(`@${row.username}`);
          continue;
        }
        await tx.update(bots).set(seal(row.id, token)).where(eq(bots.id, row.id));
        rewritten += 1;
      }
      if (rewritten > 0 || unreadable.length > 0) {
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: null,
          action: 'telegram_token.reencrypted',
          entity: 'telegram_bot',
          entityId: null,
          details: { keyVersion: current, rewritten, unreadable },
        });
      }
      return { rewritten, unreadable };
    });
  }

  return { bots: botsStore, deliveries: deliveriesStore, resealTokens };
}
