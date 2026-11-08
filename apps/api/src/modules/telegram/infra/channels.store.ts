import {
  AuditEntryIdSchema,
  CreatorIdSchema,
  CHANNEL_MAIN_MINUTE,
  TelegramChannelConfigSchema,
  TelegramChatIdSchema,
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

interface ChannelRow {
  creatorId: string;
  chatId: string | null;
  config: unknown;
  archivedAt: Date | null;
}

/**
 * A slot stored before slots had a role (ADR 0080 § 1.5, 08/11/2026) reads as the main post at 19 h, an engagement post
 * otherwise; the next save stores the role.
 */
function withSlotRoles(config: unknown): unknown {
  if (typeof config !== 'object' || config === null || !('slots' in config) || !Array.isArray(config.slots))
    return config;
  const slots: unknown[] = config.slots;
  return {
    ...config,
    slots: slots.map((slot) =>
      typeof slot === 'object' && slot !== null && !('role' in slot)
        ? { ...slot, role: 'minute' in slot && slot.minute === CHANNEL_MAIN_MINUTE ? 'main' : 'engagement' }
        : slot,
    ),
  };
}

/**
 * A row as the domain reads it. The column holds the chat: when the chat was removed (`ON DELETE SET NULL`), the
 * setting is brought back to no channel; a setting that no longer reads keeps its chat counted all the same.
 */
function toRecord(row: ChannelRow): ChannelRecord | null {
  const creatorId = CreatorIdSchema.safeParse(row.creatorId);
  if (!creatorId.success) return null;
  const chat = TelegramChatIdSchema.safeParse(row.chatId);
  const chatId = chat.success ? chat.data : null;
  const config = TelegramChannelConfigSchema.safeParse(withSlotRoles(row.config));
  return {
    creatorId: creatorId.data,
    chatId,
    config: config.success ? { ...config.data, chatId } : null,
    archived: row.archivedAt !== null,
  };
}

const rowColumns = {
  creatorId: channels.creatorId,
  chatId: channels.chatId,
  config: channels.config,
  archivedAt: schema.creators.archivedAt,
};

/**
 * The creators' channels on Postgres (ADR 0080), as the admin role: the table is closed to `nirvana_app`. The audit
 * names the creator and what changed in counts, never an address of a link.
 */
export function createPostgresChannelsStore(adminDb: Database): ChannelsStore {
  return {
    async findChannel(creatorId: CreatorId) {
      const [row] = await withAdmin(adminDb, (tx) =>
        tx
          .select(rowColumns)
          .from(channels)
          .innerJoin(schema.creators, eq(schema.creators.id, channels.creatorId))
          .where(eq(channels.creatorId, creatorId)),
      );
      return row === undefined ? null : toRecord(row);
    },
    async listChannels() {
      const rows = await withAdmin(adminDb, (tx) =>
        tx
          .select(rowColumns)
          .from(channels)
          .innerJoin(schema.creators, eq(schema.creators.id, channels.creatorId)),
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
          if (stored.chatId !== null) {
            // An archived creator posts nothing: the channel she held goes to whoever chooses it now.
            await tx
              .update(channels)
              .set({
                chatId: null,
                config: sql`jsonb_set(${channels.config}, '{chatId}', 'null'::jsonb)`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(channels.chatId, stored.chatId),
                  sql`${channels.creatorId} in (select ${schema.creators.id} from ${schema.creators} where ${schema.creators.archivedAt} is not null)`,
                ),
              );
          }
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
