import {
  AuditEntryIdSchema,
  TelegramBotIdSchema,
  TelegramBotStateSchema,
  TelegramChatIdSchema,
  TelegramChatKindSchema,
  TelegramErrorKindSchema,
  TelegramMembershipSchema,
  newId,
  type TelegramBotId,
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
  type Transaction,
} from '@impera/db';

import type { BotRecord, BotsStore, ChatRecord } from '../domain/ports';

const bots = schema.telegramBots;
const chats = schema.telegramChats;

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
          // The old group's row takes the new id, keeping its channel; a row already created for the new id goes.
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
        // Cascades to its channels.
        await tx.delete(bots).where(eq(bots.id, id));
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
        await tx.delete(chats).where(eq(chats.id, id));
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

  return { bots: botsStore, resealTokens };
}
