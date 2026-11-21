import {
  ConversationHolderSchema,
  ConversationIdSchema,
  ConversationModeSchema,
  ConversationStateSchema,
  CreatorSettingsSchema,
  CurrencySchema,
  FAN_NEW_DAYS,
  FanFlagsSchema,
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
  type ConversationState,
  type UserId,
} from '@impera/contracts';
import {
  and,
  eq,
  inArray,
  schema,
  SNAPSHOT_READ,
  sql,
  withTenant,
  type Database,
  type Transaction,
} from '@impera/db';
import { z } from 'zod';

import type { Clock, ConversationReader, MediaDescriptions, PageRequest } from '../../domain/ports';
import type { ToTalkCandidate } from '../../domain/to-talk';

import { heldBy, holderFor } from './holds';
import { openedLately, writeOpening } from './openings';
import { cursorInstant, decodeCursor, decodeSeqCursor, encodeCursor, toStoredEvent } from './rows';

const SwitchRowsSchema = z.array(z.object({ active: z.boolean() }));

/** How far back « À qui parler » reads: a whale quiet two months is still worth a word. */
const TO_TALK_LOOKBACK_DAYS = 60;
/** A bound on the rows read, the most recent first: the groups keep five each. */
const TO_TALK_ROWS_MAX = 2000;
const when = z
  .union([z.string(), z.date()])
  .nullable()
  .transform((value) => (value === null ? null : value instanceof Date ? value : new Date(value)));
const ToTalkRowsSchema = z.array(
  z.object({
    conversation_id: z.string(),
    fan_id: z.string(),
    display_name: z.string(),
    first_seen_at: when.pipe(z.date()),
    flags: z.unknown(),
    last_inbound_at: when,
    last_outbound_at: when,
    eur_minor: z.coerce.number().int(),
    usd_minor: z.coerce.number().int(),
    last_purchase_at: when,
    held_by: z.string().nullable(),
  }),
);
const RateRowsSchema = z.array(z.object({ rate_micros: z.coerce.number().int().positive() }));

const OPEN_DRAFT_STATUSES = ['pending', 'approved', 'edited'];
/** The states where the agent answers him again after a failed send; once a human holds it or it rests, it is theirs. */
const AGENT_ANSWERING: readonly ConversationState[] = ['pending', 'drafting', 'awaiting_approval', 'sending'];

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
  readerId: UserId,
): Promise<{ summary: ConversationSummary; cursorAt: string }[]> {
  const rows = await tx
    .select({
      id: schema.conversations.id,
      fanId: schema.conversations.fanId,
      fanDisplayName: schema.fans.displayName,
      state: schema.conversations.state,
      mode: schema.conversations.mode,
      // When he wrote, on the platform's clock: `conversations.last_inbound_at` is when Impera read it, which a capture
      // reading back his history puts hours late. The column keeps its own use, the order of arrival (message-flow.md).
      lastInboundAt: lastInboundOnPlatform,
      lastOutboundAt: schema.conversations.lastOutboundAt,
      unreadCount: schema.conversations.unreadCount,
      updatedAt: schema.conversations.updatedAt,
      desireScore: schema.conversations.desireScore,
      desireAt: schema.conversations.desireAt,
      careSince: schema.conversations.careSince,
      heldBy: sql<string | null>`${holderFor(sql`${readerId}`)}`,
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
      heldBy: ConversationHolderSchema.nullable().parse(row.heldBy),
      careSince: row.careSince?.toISOString() ?? null,
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
export function mediaOf(
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
    // The same latest-switch-per-scope rule as the send gate (unit-of-work `blockedReason`), without the conversation.
    sendingStopped: (creatorId) =>
      withTenant(db, creatorId, async (tx) => {
        const switches = await tx.execute(sql`
          select distinct on (scope, scope_id) (active and (active_until is null or active_until > now())) as active
          from kill_switches
          where scope = 'global' or (scope = 'creator' and scope_id = ${creatorId})
          order by scope, scope_id, set_at desc`);
        return SwitchRowsSchema.parse(switches.rows).some((row) => row.active);
      }),

    list: (creatorId, page, { userId, heldOnly }) =>
      withTenant(db, creatorId, async (tx) => {
        const after = decodeCursor(page.cursor);
        const rows = await summaries(
          tx,
          and(
            after === null
              ? undefined
              : sql`(${schema.conversations.updatedAt}, ${schema.conversations.id}) < (${after.at}::timestamptz, ${after.id}::uuid)`,
            heldOnly ? heldBy(sql`${userId}`) : undefined,
          ),
          page.limit + 1,
          clock.now(),
          userId,
        );
        const { items, nextCursor } = paged(rows, page, (last) =>
          encodeCursor(last.cursorAt, last.summary.id),
        );
        return { items: items.map((row) => row.summary), nextCursor };
      }),

    toTalkCandidates: (creatorId, { userId, heldOnly }) =>
      withTenant(db, creatorId, async (tx) => {
        const now = clock.now();
        // What he paid, as « Fans » reads it (ADR 0124): the platform's register, his sales less their refunds, by
        // currency, VAT included as Reveal shows it.
        const result = await tx.execute(sql`
          with net as (
            select s.platform_account_id as account, s.platform_fan_id as fan, s.currency, s.occurred_at,
                   s.gross_incl_vat_minor - coalesce(r.gross_incl_vat_minor, 0) as gross
              from platform_sales s
              left join platform_sales r
                on r.creator_id = ${creatorId}::uuid and r.event = 'refund'
               and r.platform = s.platform and r.platform_sale_id = s.platform_sale_id
             where s.creator_id = ${creatorId}::uuid and s.event = 'sale' and s.platform_fan_id is not null),
          paid as (
            select account, fan,
                   coalesce(sum(gross) filter (where currency = 'EUR'), 0) as eur_minor,
                   coalesce(sum(gross) filter (where currency = 'USD'), 0) as usd_minor,
                   max(occurred_at) filter (where gross > 0) as last_purchase_at
              from net group by account, fan)
          select conversations.id as conversation_id, conversations.fan_id, f.display_name, f.first_seen_at, f.flags,
                 -- On the platform's clock as the list reads it; Impera's own time before a message is kept.
                 coalesce((select max(m.platform_created_at) from messages m
                   where m.conversation_id = conversations.id and m.direction = 'inbound'),
                   conversations.last_inbound_at) as last_inbound_at,
                 conversations.last_outbound_at,
                 coalesce(p.eur_minor, 0) as eur_minor, coalesce(p.usd_minor, 0) as usd_minor,
                 p.last_purchase_at,
                 ${holderFor(sql`${userId}`)} as held_by
          from conversations
          join fans f on f.id = conversations.fan_id
          left join paid p on p.account = f.platform_account_id and p.fan = f.platform_fan_id
          where conversations.creator_id = ${creatorId}::uuid
            and (conversations.updated_at > ${now.toISOString()}::timestamptz - make_interval(days => ${TO_TALK_LOOKBACK_DAYS})
                 or f.first_seen_at > ${now.toISOString()}::timestamptz - make_interval(days => ${FAN_NEW_DAYS}))
            ${heldOnly ? sql`and ${heldBy(sql`${userId}`)}` : sql``}
          order by conversations.updated_at desc
          limit ${TO_TALK_ROWS_MAX}`);
        const rate = await tx.execute(
          sql`select rate_micros from exchange_rates where currency = 'USD' order by day desc limit 1`,
        );
        const [creator] = await tx
          .select({ settings: schema.creators.settings })
          .from(schema.creators)
          .where(eq(schema.creators.id, creatorId));
        const rateMicros = RateRowsSchema.parse(rate.rows)[0]?.rate_micros ?? null;
        const settings = CreatorSettingsSchema.safeParse(creator?.settings ?? {});
        const tiers = (settings.success ? settings.data : CreatorSettingsSchema.parse({})).fanTiers;
        const candidates = ToTalkRowsSchema.parse(result.rows).map((row): ToTalkCandidate => {
          const flags = FanFlagsSchema.safeParse(row.flags);
          const f = flags.success ? flags.data : {};
          return {
            conversationId: ConversationIdSchema.parse(row.conversation_id),
            fanId: FanIdSchema.parse(row.fan_id),
            fanDisplayName: row.display_name,
            fanSince: row.first_seen_at,
            lastInboundAt: row.last_inbound_at,
            lastOutboundAt: row.last_outbound_at,
            // His dollars at the last known rate, as the Dashboard ranks its fans; without a rate they do not count.
            spentMinor: Math.max(
              0,
              row.eur_minor +
                (rateMicros === null ? 0 : Math.round((row.usd_minor * rateMicros) / 1_000_000)),
            ),
            lastPurchaseAt: row.last_purchase_at,
            heldByOther: row.held_by === 'other',
            // A flag that no longer reads holds him as a doubt would: never listed by mistake.
            ageDisputed: !flags.success || f.ageDisputed !== undefined,
            doNotContact: f.doNotContact === true,
            noFollowUp: f.salesFrozen !== undefined || f.fragile === true,
          };
        });
        return { candidates, tiers };
      }),

    isHeldBy: (creatorId, id, userId) =>
      withTenant(db, creatorId, async (tx) => {
        const [row] = await tx
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(and(eq(schema.conversations.id, id), heldBy(sql`${userId}`)));
        return row !== undefined;
      }),

    holderOf: (creatorId, id, userId) =>
      withTenant(db, creatorId, async (tx) => {
        const [row] = await tx
          .select({ holder: sql<string | null>`${holderFor(sql`${userId}`)}` })
          .from(schema.conversations)
          .where(eq(schema.conversations.id, id));
        return row === undefined ? null : ConversationHolderSchema.nullable().parse(row.holder);
      }),

    isFanHeldBy: (creatorId, fanId, userId) =>
      withTenant(db, creatorId, async (tx) => {
        const [row] = await tx
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(and(eq(schema.conversations.fanId, fanId), heldBy(sql`${userId}`)))
          .limit(1);
        return row !== undefined;
      }),

    traceOpening: (creatorId, id, { userId, ip, via }) =>
      withTenant(db, creatorId, async (tx) => {
        if (!(await exists(tx, id))) return false;
        if (!(await openedLately(tx, userId, id)))
          await writeOpening(tx, {
            userId,
            id,
            ip,
            creatorId,
            by: 'chatter',
            ...(via === undefined ? {} : { via }),
          });
        return true;
      }),

    traceFanOpening: (creatorId, fanId, { userId, ip, via }) =>
      withTenant(db, creatorId, async (tx) => {
        const rows = await tx
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(eq(schema.conversations.fanId, fanId));
        for (const row of rows) {
          const id = ConversationIdSchema.parse(row.id);
          if (!(await openedLately(tx, userId, id)))
            await writeOpening(tx, { userId, id, ip, creatorId, by: 'chatter', via });
        }
      }),

    fanMessageTexts: (creatorId, fanId, messageIds) =>
      withTenant(db, creatorId, async (tx) => {
        if (messageIds.length === 0) return new Map<string, string>();
        const rows = await tx
          .select({ id: schema.messages.id, text: schema.messages.text })
          .from(schema.messages)
          .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
          .where(
            and(
              eq(schema.conversations.fanId, fanId),
              eq(schema.messages.direction, 'inbound'),
              eq(schema.messages.author, 'fan'),
              inArray(schema.messages.id, [...messageIds]),
            ),
          );
        return new Map(rows.map((row) => [row.id, row.text]));
      }),

    // State and open drafts in one snapshot: read apart, a draft committed in between showed with the old state.
    get: (creatorId, id, userId) =>
      withTenant(
        db,
        creatorId,
        async (tx) => {
          const [found] = await summaries(tx, eq(schema.conversations.id, id), 1, clock.now(), userId);
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
          // What did not leave: the latest draft whose send failed for good, while nothing left after it. A fan who
          // writes again takes the conversation out of `error` (recette CHAT-12), the failure stays in sight.
          const [failed] = await tx
            .select()
            .from(schema.drafts)
            .where(and(eq(schema.drafts.conversationId, id), eq(schema.drafts.status, 'failed')))
            .orderBy(sql`${schema.drafts.createdAt} desc`)
            .limit(1);
          // Its own bubbles that left before one failed (a partial send) are not « something after it ».
          const lastOut =
            failed === undefined || summary.state === 'error' || !AGENT_ANSWERING.includes(summary.state)
              ? null
              : ((
                  await tx
                    .select({
                      at: sql<
                        number | null
                      >`(extract(epoch from max(${schema.messages.platformCreatedAt})) * 1000)::float8`,
                    })
                    .from(schema.messages)
                    .where(
                      and(
                        eq(schema.messages.conversationId, id),
                        eq(schema.messages.direction, 'outbound'),
                        sql`${schema.messages.draftId} is distinct from ${failed.id}`,
                      ),
                    )
                )[0]?.at ?? null);
          const stillUnsent =
            failed !== undefined &&
            (summary.state === 'error' ||
              (AGENT_ANSWERING.includes(summary.state) &&
                (lastOut === null || failed.createdAt.getTime() > lastOut)));
          return {
            ...summary,
            openDrafts: drafts.map(draftView),
            failedDraft: stillUnsent ? draftView(failed) : null,
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
