import {
  ConversationIdSchema,
  CreatorIdSchema,
  CurrencySchema,
  FanIdSchema,
  MediaAssetIdSchema,
  MessageDirectionSchema,
  MessageIdSchema,
  newId,
  AuditEntryIdSchema,
  type ConversationId,
  type CreatorFan,
} from '@impera/contracts';
import { and, eq, schema, sql, withCreatorAccount, type Database, type Transaction } from '@impera/db';
import { z } from 'zod';

import type { CreatorSpaceReader, MediaDescriptions, PageRequest } from '../../domain/ports';

import { mediaOf } from './reader';
import { cursorInstant, decodeCursor, encodeCursor } from './rows';

/** One more row than asked tells whether a next page exists. */
function paged<T>(rows: readonly T[], page: PageRequest, cursorOf: (last: T) => string) {
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > page.limit && last !== undefined ? cursorOf(last) : null };
}

const minor = z.coerce.number().int().nonnegative();

/** What each fan paid in his conversations, per currency: unlocked paid messages only, as the Dashboard counts them. */
async function spentOf(
  tx: Transaction,
  fanIds: readonly string[],
): Promise<Map<string, CreatorFan['spent']>> {
  if (fanIds.length === 0) return new Map();
  const result = await tx.execute(
    sql`select c.fan_id,
               coalesce(sum(m.price_minor) filter (where m.currency = 'EUR'), 0) as eur_minor,
               coalesce(sum(m.price_minor) filter (where m.currency = 'USD'), 0) as usd_minor
        from messages m
        join conversations c on c.id = m.conversation_id
        where m.direction = 'outbound' and m.is_paid and m.price_minor > 0
          and c.fan_id = any(${sql.param([...fanIds])}::uuid[])
        group by c.fan_id`,
  );
  const rows = z
    .array(z.object({ fan_id: z.string(), eur_minor: minor, usd_minor: minor }))
    .parse(result.rows);
  return new Map(rows.map((row) => [row.fan_id, { eurMinor: row.eur_minor, usdMinor: row.usd_minor }]));
}

/** Her conversation of that id, with its fan; none when she has no conversation of that id (RLS, her creator only). */
async function conversationOf(tx: Transaction, id: ConversationId) {
  const [row] = await tx
    .select({ id: schema.conversations.id, fanId: schema.fans.id, displayName: schema.fans.displayName })
    .from(schema.conversations)
    .innerJoin(schema.fans, eq(schema.fans.id, schema.conversations.fanId))
    .where(eq(schema.conversations.id, id));
  return row;
}

/**
 * The creator's reads of her own account (CR-02), each in her own transaction (`withCreatorAccount`): her role and her
 * creator come from her account, and the restrictive policies close to her what only the agency reads. The columns are
 * named one by one: `messages.author` and `messages.draft_id` are never selected (ADR 0021), and the contracts are
 * `strict`, so an added field fails before it reaches her.
 */
export function createDrizzleCreatorSpaceReader(
  db: Database,
  mediaDescriptions: MediaDescriptions,
): CreatorSpaceReader {
  return {
    fans: (userId, page) =>
      withCreatorAccount(db, userId, async (tx) => {
        const after = decodeCursor(page.cursor);
        const rows = await tx
          .select({
            id: schema.fans.id,
            displayName: schema.fans.displayName,
            firstSeenAt: schema.fans.firstSeenAt,
            lastSeenAt: schema.fans.lastSeenAt,
            conversationId: sql<string | null>`(select c.id from ${schema.conversations} c
              where c.fan_id = fans.id order by c.updated_at desc, c.id desc limit 1)`,
            cursorAt: cursorInstant(schema.fans.lastSeenAt),
          })
          .from(schema.fans)
          .where(
            after === null
              ? undefined
              : sql`(${schema.fans.lastSeenAt}, ${schema.fans.id}) < (${after.at}::timestamptz, ${after.id}::uuid)`,
          )
          .orderBy(sql`${schema.fans.lastSeenAt} desc, ${schema.fans.id} desc`)
          .limit(page.limit + 1);
        const { items, nextCursor } = paged(rows, page, (last) => encodeCursor(last.cursorAt, last.id));
        const spent = await spentOf(
          tx,
          items.map((row) => row.id),
        );
        return {
          items: items.map((row) => ({
            id: FanIdSchema.parse(row.id),
            displayName: row.displayName,
            conversationId:
              row.conversationId === null ? null : ConversationIdSchema.parse(row.conversationId),
            spent: spent.get(row.id) ?? { eurMinor: 0, usdMinor: 0 },
            firstSeenAt: row.firstSeenAt.toISOString(),
            lastSeenAt: row.lastSeenAt.toISOString(),
          })),
          nextCursor,
        };
      }),

    openConversation: async (userId, id, ip) => {
      const opened = await withCreatorAccount(db, userId, async (tx, creatorId) => {
        const row = await conversationOf(tx, id);
        if (row === undefined) return null;
        // Each opening, as a chatter's (ADR 0042 § 2): in the same transaction as the read.
        await tx.insert(schema.auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId,
          action: 'conversation.open',
          entity: 'conversation',
          entityId: id,
          ip,
          details: { creatorId, by: 'creator' },
        });
        return { row };
      });
      if (opened === null) return null;
      const { row } = opened;
      // No note of her fan: what the agency knows of him is its own (Charles, 03/11).
      return {
        id: ConversationIdSchema.parse(row.id),
        fan: { id: FanIdSchema.parse(row.fanId), displayName: row.displayName },
      };
    },

    messages: async (userId, id, page) => {
      const read = await withCreatorAccount(db, userId, async (tx, creatorId) => {
        if ((await conversationOf(tx, id)) === undefined) return null;
        const after = decodeCursor(page.cursor);
        const rows = await tx
          .select({
            id: schema.messages.id,
            direction: schema.messages.direction,
            text: schema.messages.text,
            mediaIds: schema.messages.mediaIds,
            platformMedia: schema.messages.platformMedia,
            priceMinor: schema.messages.priceMinor,
            currency: schema.messages.currency,
            isPaid: schema.messages.isPaid,
            platformCreatedAt: schema.messages.platformCreatedAt,
            cursorAt: cursorInstant(schema.messages.platformCreatedAt),
          })
          .from(schema.messages)
          .where(
            and(
              eq(schema.messages.conversationId, id),
              after === null
                ? undefined
                : sql`(${schema.messages.platformCreatedAt}, ${schema.messages.id}) < (${after.at}::timestamptz, ${after.id}::uuid)`,
            ),
          )
          .orderBy(sql`${schema.messages.platformCreatedAt} desc, ${schema.messages.id} desc`)
          .limit(page.limit + 1);
        return { creatorId, ...paged(rows, page, (last) => encodeCursor(last.cursorAt, last.id)) };
      });
      if (read === null) return null;
      // Outside the read: the `media` module reads its own table, bound to the creator her account names.
      const stored = read.items.flatMap((row) => row.mediaIds.map((m) => MediaAssetIdSchema.parse(m)));
      const descriptions =
        stored.length === 0
          ? new Map<string, string>()
          : await mediaDescriptions.of(CreatorIdSchema.parse(read.creatorId), stored);
      return {
        items: read.items.map((row) => ({
          id: MessageIdSchema.parse(row.id),
          direction: MessageDirectionSchema.parse(row.direction),
          text: row.text,
          media: mediaOf(row.platformMedia, row.mediaIds, descriptions),
          priceMinor: row.priceMinor,
          currency: row.currency === null ? null : CurrencySchema.parse(row.currency),
          isPaid: row.isPaid,
          platformCreatedAt: row.platformCreatedAt.toISOString(),
        })),
        nextCursor: read.nextCursor,
      };
    },
  };
}
