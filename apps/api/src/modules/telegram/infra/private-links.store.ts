import { AuditEntryIdSchema, TelegramBotIdSchema, newId } from '@impera/contracts';
import { eq, schema, withAdmin, type Database } from '@impera/db';

import type { PrivateLinksStore } from '../domain/ports';

const codes = schema.telegramLinkCodes;
const links = schema.telegramPrivateLinks;

/**
 * The private links of ADR 0068 § 4 on Postgres, as the admin role: both tables are closed to `nirvana_app`. The audit
 * names the account and the bot, never the code nor the chat.
 */
export function createPostgresPrivateLinksStore(adminDb: Database): PrivateLinksStore {
  return {
    issueCode: (userId, codeHash, expiresAt) =>
      withAdmin(adminDb, async (tx) => {
        await tx.delete(codes).where(eq(codes.userId, userId));
        await tx.insert(codes).values({ codeHash, userId, expiresAt });
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId,
          action: 'telegram_private_link.code',
          entity: 'user',
          entityId: userId,
          details: { expiresAt: expiresAt.toISOString() },
        });
      }),
    claimCode: (codeHash, botId, telegramChatId, now) =>
      withAdmin(adminDb, async (tx) => {
        // Taken whatever it holds: an expired code is gone too, and a replayed one finds nothing.
        const [taken] = await tx.delete(codes).where(eq(codes.codeHash, codeHash)).returning();
        if (taken === undefined || taken.expiresAt <= now) return null;
        await tx
          .insert(links)
          .values({ userId: taken.userId, botId, telegramChatId, linkedAt: now })
          .onConflictDoUpdate({ target: links.userId, set: { botId, telegramChatId, linkedAt: now } });
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: taken.userId,
          action: 'telegram_private_link.link',
          entity: 'user',
          entityId: taken.userId,
          details: { botId },
        });
        return taken.userId;
      }),
    findLink: async (userId) => {
      const [row] = await withAdmin(adminDb, (tx) => tx.select().from(links).where(eq(links.userId, userId)));
      return row === undefined
        ? null
        : {
            botId: TelegramBotIdSchema.parse(row.botId),
            telegramChatId: row.telegramChatId,
            linkedAt: row.linkedAt,
          };
    },
    removeLink: (userId) =>
      withAdmin(adminDb, async (tx) => {
        const removed = await tx
          .delete(links)
          .where(eq(links.userId, userId))
          .returning({ botId: links.botId });
        // A code still pending would link the chat again: unlinking drops it too.
        await tx.delete(codes).where(eq(codes.userId, userId));
        if (removed.length === 0) return false;
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId,
          action: 'telegram_private_link.remove',
          entity: 'user',
          entityId: userId,
          details: {},
        });
        return true;
      }),
  };
}
