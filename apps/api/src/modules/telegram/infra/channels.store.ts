import {
  AuditEntryIdSchema,
  CreatorIdSchema,
  TelegramChannelConfigSchema,
  newId,
  type CreatorId,
} from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, type Database } from '@impera/db';

import type { ChannelRecord, ChannelsStore } from '../domain/ports';

const channels = schema.telegramChannels;

/** The Postgres error code of a failure, through Drizzle's wrapping. */
function pgCodeOf(error: unknown): { code: string; constraint: string | null } | null {
  for (let current = error; typeof current === 'object' && current !== null;) {
    if ('code' in current && typeof current.code === 'string') {
      const constraint =
        'constraint' in current && typeof current.constraint === 'string' ? current.constraint : null;
      return { code: current.code, constraint };
    }
    current = 'cause' in current ? current.cause : null;
  }
  return null;
}

function toRecord(row: { creatorId: string; config: unknown }): ChannelRecord | null {
  const config = TelegramChannelConfigSchema.safeParse(row.config);
  const creatorId = CreatorIdSchema.safeParse(row.creatorId);
  return config.success && creatorId.success ? { creatorId: creatorId.data, config: config.data } : null;
}

/**
 * The creators' channels on Postgres (ADR 0080), as the admin role: the table is closed to `nirvana_app`. The audit
 * names the creator and what changed in counts, never an address of a link.
 */
export function createPostgresChannelsStore(adminDb: Database): ChannelsStore {
  return {
    async findChannel(creatorId: CreatorId) {
      const [row] = await withAdmin(adminDb, (tx) =>
        tx
          .select({ creatorId: channels.creatorId, config: channels.config })
          .from(channels)
          .where(eq(channels.creatorId, creatorId)),
      );
      return row === undefined ? null : toRecord(row);
    },
    async listChannels() {
      const rows = await withAdmin(adminDb, (tx) =>
        tx.select({ creatorId: channels.creatorId, config: channels.config }).from(channels),
      );
      return rows.flatMap((row) => {
        const record = toRecord(row);
        return record === null ? [] : [record];
      });
    },
    async creatorActive(creatorId) {
      const [row] = await withAdmin(adminDb, (tx) =>
        tx
          .select({ id: schema.creators.id })
          .from(schema.creators)
          .where(and(eq(schema.creators.id, creatorId), sql`${schema.creators.archivedAt} is null`)),
      );
      return row !== undefined;
    },
    async saveChannel(creatorId, config, userId) {
      try {
        await withAdmin(adminDb, async (tx) => {
          const stored = TelegramChannelConfigSchema.parse(config);
          await tx
            .insert(channels)
            .values({ creatorId, chatId: stored.chatId, config: stored, updatedBy: userId })
            .onConflictDoUpdate({
              target: channels.creatorId,
              set: { chatId: stored.chatId, config: stored, updatedBy: userId, updatedAt: new Date() },
            });
          await tx.insert(schema.auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId,
            action: 'telegram_channel.save',
            entity: 'creator',
            entityId: creatorId,
            details: {
              channel: stored.chatId !== null,
              slots: stored.slots.filter((slot) => slot.enabled).length,
              links: stored.links.length,
              withoutValidation: stored.publishWithoutValidation,
            },
          });
        });
        return 'saved';
      } catch (error) {
        const failure = pgCodeOf(error);
        if (failure?.code === '23505' && failure.constraint === 'telegram_channels_chat_unique') {
          return 'chat_taken';
        }
        throw error;
      }
    },
  };
}
