import {
  ConversationIdSchema,
  ConversationModeSchema,
  ConversationStateSchema,
  CurrencySchema,
  DESIRE_POINTS_MAX,
  desireBandOf,
  desireNow,
  DraftIdSchema,
  DraftStatusSchema,
  ExternalMediaSchema,
  FanIdSchema,
  MediaAssetIdSchema,
  MessageAuthorSchema,
  MessageDirectionSchema,
  MessageIdSchema,
  type ConversationDesire,
  type ConversationId,
  type ConversationSummary,
  type DraftView,
  type MessageMediaView,
} from '@nirvana/contracts';
import {
  and,
  eq,
  schema,
  SNAPSHOT_READ,
  sql,
  withTenant,
  type Database,
  type Transaction,
} from '@nirvana/db';
import { z } from 'zod';

import type { Clock, ConversationReader, MediaDescriptions, PageRequest } from '../../domain/ports';

import { cursorInstant, decodeCursor, decodeSeqCursor, encodeCursor, toStoredEvent } from './rows';

const OPEN_DRAFT_STATUSES = ['pending', 'approved', 'edited'];

/** One more row than asked tells whether a next page exists. */
function paged<T>(rows: readonly T[], page: PageRequest, cursorOf: (last: T) => string) {
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > page.limit && last !== undefined ? cursorOf(last) : null };
}

/**
 * The purchase floor of the cooling: 20 once he bought in the last seven days, read from `sales` once P6-01 exists;
 * 0 until then, as for the engine.
 */
const DESIRE_FLOOR = 0;

/** The stored score cooled to `now`, and the band of that cooled score (never the stored band). */
function desireAt(score: number | null, at: Date | null, now: Date): ConversationDesire | null {
  if (score === null || at === null) return null;
  const cooled = desireNow({ score, at }, now, DESIRE_FLOOR);
  return { score: cooled, band: desireBandOf(cooled) };
}

/** The latest of his messages, on the platform's clock; `null` before his first. */
const lastInboundOnPlatform = sql`(select max(${schema.messages.platformCreatedAt}) from ${schema.messages}
  where ${schema.messages.conversationId} = ${schema.conversations.id} and ${schema.messages.direction} = 'inbound')`.mapWith(
  // As the column's own decoder does: the driver hands a timestamptz back as text.
  (value: string | Date | null): Date | null =>
    value === null ? null : value instanceof Date ? value : new Date(value),
);

async function summaries(
  tx: Transaction,
  where: ReturnType<typeof and>,
  limit: number,
  now: Date,
): Promise<{ summary: ConversationSummary; cursorAt: string }[]> {
  const rows = await tx
    .select({
      id: schema.conversations.id,
      fanId: schema.conversations.fanId,
      fanDisplayName: schema.fans.displayName,
      state: schema.conversations.state,
      mode: schema.conversations.mode,
      // When he wrote, on the platform's clock: `conversations.last_inbound_at` is when Nirvana read it, which a capture
      // reading back his history puts hours late. The column keeps its own use, the order of arrival (message-flow.md).
      lastInboundAt: lastInboundOnPlatform,
      lastOutboundAt: schema.conversations.lastOutboundAt,
      unreadCount: schema.conversations.unreadCount,
      updatedAt: schema.conversations.updatedAt,
      desireScore: schema.conversations.desireScore,
      desireAt: schema.conversations.desireAt,
      cursorAt: cursorInstant(schema.conversations.updatedAt),
    })
    .from(schema.conversations)
    .innerJoin(schema.fans, eq(schema.fans.id, schema.conversations.fanId))
    .where(where)
    .orderBy(sql`${schema.conversations.updatedAt} desc, ${schema.conversations.id} desc`)
    .limit(limit);
  return rows.map((row) => ({
    cursorAt: row.cursorAt,
    summary: {
      id: ConversationIdSchema.parse(row.id),
      fanId: FanIdSchema.parse(row.fanId),
      fanDisplayName: row.fanDisplayName,
      state: ConversationStateSchema.parse(row.state),
      mode: ConversationModeSchema.parse(row.mode),
      lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
      lastOutboundAt: row.lastOutboundAt?.toISOString() ?? null,
      unreadCount: row.unreadCount,
      updatedAt: row.updatedAt.toISOString(),
      desire: desireAt(row.desireScore, row.desireAt, now),
    },
  }));
}

function draftView(draft: typeof schema.drafts.$inferSelect): DraftView {
  return {
    id: DraftIdSchema.parse(draft.id),
    status: DraftStatusSchema.parse(draft.status),
    bubbles: draft.bubbles,
    finalBubbles: draft.finalBubbles,
    createdAt: draft.createdAt.toISOString(),
  };
}

/** Whether the creator has this conversation (RLS: another creator's is not there). */
async function exists(tx: Transaction, id: ConversationId): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, id));
  return row !== undefined;
}

/** Written by ingestion only, through the contract's schema: read back through it too (a column is a boundary). */
const PlatformMediaSchema = z.array(ExternalMediaSchema);

/**
 * A message's media for Suivi (SUIVI-26): kind and lock from the platform's list, the description from the media the
 * `media` module stored for it (`media_ids`, in the platform's order), only when both lists match one to one.
 */
function mediaOf(
  platformMedia: unknown,
  mediaIds: readonly string[],
  descriptions: ReadonlyMap<string, string>,
): MessageMediaView[] {
  const listed = PlatformMediaSchema.parse(platformMedia);
  const paired = mediaIds.length === listed.length;
  return listed.map((media, index) => {
    const stored = paired ? mediaIds[index] : undefined;
    return {
      kind: media.kind,
      isLocked: media.isLocked,
      description: stored === undefined ? null : (descriptions.get(stored) ?? null),
    };
  });
}

/** The inbox's queries, in tenant transactions like everything else (RLS). */
export function createDrizzleConversationReader(
  db: Database,
  clock: Clock,
  mediaDescriptions: MediaDescriptions,
): ConversationReader {
  return {
    list: (creatorId, page, routedTo) =>
      withTenant(db, creatorId, async (tx) => {
        const after = decodeCursor(page.cursor);
        const rows = await summaries(
          tx,
          and(
            after === null
              ? undefined
              : sql`(${schema.conversations.updatedAt}, ${schema.conversations.id}) < (${after.at}::timestamptz, ${after.id}::uuid)`,
            routedTo === undefined ? undefined : eq(schema.conversations.routedToUserId, routedTo),
          ),
          page.limit + 1,
          clock.now(),
        );
        const { items, nextCursor } = paged(rows, page, (last) =>
          encodeCursor(last.cursorAt, last.summary.id),
        );
        return { items: items.map((row) => row.summary), nextCursor };
      }),

    isRoutedTo: (creatorId, id, userId) =>
      withTenant(db, creatorId, async (tx) => {
        const [row] = await tx
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(and(eq(schema.conversations.id, id), eq(schema.conversations.routedToUserId, userId)));
        return row !== undefined;
      }),

    // State and open drafts in one snapshot: read apart, a draft committed in between showed with the old state.
    get: (creatorId, id) =>
      withTenant(
        db,
        creatorId,
        async (tx) => {
          const [found] = await summaries(tx, eq(schema.conversations.id, id), 1, clock.now());
          if (found === undefined) return null;
          const { summary } = found;
          const drafts = await tx
            .select()
            .from(schema.drafts)
            .where(
              and(
                eq(schema.drafts.conversationId, id),
                sql`${schema.drafts.status} in ${OPEN_DRAFT_STATUSES}`,
              ),
            )
            .orderBy(schema.drafts.createdAt);
          // In `error`, what did not leave: the latest draft whose send failed for good.
          const [failed] =
            summary.state === 'error'
              ? await tx
                  .select()
                  .from(schema.drafts)
                  .where(and(eq(schema.drafts.conversationId, id), eq(schema.drafts.status, 'failed')))
                  .orderBy(sql`${schema.drafts.createdAt} desc`)
                  .limit(1)
              : [];
          return {
            ...summary,
            openDrafts: drafts.map(draftView),
            failedDraft: failed === undefined ? null : draftView(failed),
          };
        },
        SNAPSHOT_READ,
      ),

    messages: async (creatorId, id, page) => {
      const read = await withTenant(db, creatorId, async (tx) => {
        if (!(await exists(tx, id))) return null;
        const after = decodeCursor(page.cursor);
        const rows = await tx
          .select({ row: schema.messages, cursorAt: cursorInstant(schema.messages.platformCreatedAt) })
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
        return paged(rows, page, (last) => encodeCursor(last.cursorAt, last.row.id));
      });
      if (read === null) return null;
      // Outside the read: the `media` module reads its own table, in its own transaction.
      const stored = read.items.flatMap(({ row }) => row.mediaIds.map((m) => MediaAssetIdSchema.parse(m)));
      const descriptions =
        stored.length === 0 ? new Map<string, string>() : await mediaDescriptions.of(creatorId, stored);
      return {
        items: read.items.map(({ row }) => ({
          id: MessageIdSchema.parse(row.id),
          direction: MessageDirectionSchema.parse(row.direction),
          author: MessageAuthorSchema.parse(row.author),
          text: row.text,
          media: mediaOf(row.platformMedia, row.mediaIds, descriptions),
          priceMinor: row.priceMinor,
          currency: row.currency === null ? null : CurrencySchema.parse(row.currency),
          isPaid: row.isPaid,
          draftId: row.draftId === null ? null : DraftIdSchema.parse(row.draftId),
          platformCreatedAt: row.platformCreatedAt.toISOString(),
        })),
        nextCursor: read.nextCursor,
      };
    },

    events: (creatorId, id, page) =>
      withTenant(db, creatorId, async (tx) => {
        if (!(await exists(tx, id))) return null;
        const before = decodeSeqCursor(page.cursor);
        const rows = await tx
          .select()
          .from(schema.conversationEvents)
          .where(
            and(
              eq(schema.conversationEvents.conversationId, id),
              before === null ? undefined : sql`${schema.conversationEvents.seq} < ${before}`,
            ),
          )
          .orderBy(sql`${schema.conversationEvents.seq} desc`)
          .limit(page.limit + 1);
        return paged(
          rows.map((row) => {
            const event = toStoredEvent(row);
            return { ...event.body, seq: event.seq, actor: event.actor, createdAt: event.at.toISOString() };
          }),
          page,
          (last) => String(last.seq),
        );
      }),

    desireCurve: (creatorId, id) =>
      withTenant(db, creatorId, async (tx) => {
        if (!(await exists(tx, id))) return null;
        const rows = await tx
          .select()
          .from(schema.conversationEvents)
          .where(
            and(
              eq(schema.conversationEvents.conversationId, id),
              eq(schema.conversationEvents.type, 'desire_scored'),
            ),
          )
          .orderBy(sql`${schema.conversationEvents.seq} desc`)
          .limit(DESIRE_POINTS_MAX);
        // `weightsVersion` stays in the journal: the screen reads the movement and its signals.
        return {
          points: rows.toReversed().flatMap((row) => {
            const event = toStoredEvent(row);
            if (event.body.type !== 'desire_scored') return [];
            const { before, score, signals } = event.body.payload;
            return [{ at: event.at.toISOString(), before, score, signals }];
          }),
        };
      }),
  };
}
