import {
  AlertTriggerSchema,
  ConversationIdSchema,
  EventIdSchema,
  FanIdSchema,
  DomainError,
  type CreatorId,
  type EventId,
  type UserId,
} from '@nirvana/contracts';
import { and, eq, schema, sql, withTenant, type Database, type Transaction } from '@nirvana/db';
import { z } from 'zod';

import type { AlertHistory, AlertTriggerFilter } from '../../domain/ports';

const events = schema.conversationEvents;
const seen = schema.alertSeen;

/** Her triggers: every `alert_triggered`, and a `handoff_requested` that carries one (P4-01). */
const isTrigger = sql`(${events.type} = 'alert_triggered'
  or (${events.type} = 'handoff_requested' and ${events.payload} -> 'trigger' is not null))`;

const TriggerPayloadSchema = z.object({ trigger: AlertTriggerSchema });

class CursorInvalid extends DomainError {
  constructor() {
    super('cursor_invalid', 'Curseur de pagination invalide');
  }
}

/**
 * A page's cursor names its last trigger, whose place in the list is read again in the base: `created_at` keeps its
 * microseconds there, which a date sent back through JSON would round (two triggers of the same millisecond).
 */
const encodeTriggerCursor = (id: EventId): string => Buffer.from(id).toString('base64url');

function decodeTriggerCursor(cursor: string | undefined): EventId | null {
  if (cursor === undefined) return null;
  const parsed = EventIdSchema.safeParse(Buffer.from(cursor, 'base64url').toString());
  if (!parsed.success) throw new CursorInvalid();
  return parsed.data;
}

/** The place of one of her triggers in the list, `(created_at, id)`, read in the base; `null` when she has none so. */
async function placeOf(tx: Transaction, id: EventId): Promise<ReturnType<typeof sql> | null> {
  const [found] = await tx
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.id, id), isTrigger));
  return found === undefined
    ? null
    : sql`(select ${events.createdAt}, ${events.id} from ${events} where ${events.id} = ${id})`;
}

function alertIs(alert: NonNullable<AlertTriggerFilter['alert']>): ReturnType<typeof sql> {
  if (alert.kind === 'none') return sql`false`;
  const ref = sql`${events.payload} -> 'trigger' -> 'alert'`;
  return alert.kind === 'custom'
    ? sql`(${ref} ->> 'kind' = 'custom' and ${ref} ->> 'id' = ${alert.id})`
    : sql`(${ref} ->> 'kind' = 'system' and ${ref} ->> 'code' = ${alert.code})`;
}

/** The history of her alerts, under her RLS like everything else; the seen mark is the agency's, one per event. */
export function createDrizzleAlertHistory(db: Database): AlertHistory {
  return {
    list: (creatorId, filter, page) =>
      withTenant(db, creatorId, async (tx) => {
        const cursor = decodeTriggerCursor(page.cursor);
        const after = cursor === null ? null : await placeOf(tx, cursor);
        if (cursor !== null && after === null) throw new CursorInvalid();
        const rows = await tx
          .select({
            id: events.id,
            type: events.type,
            payload: events.payload,
            conversationId: events.conversationId,
            fanId: schema.conversations.fanId,
            fanDisplayName: schema.fans.displayName,
            at: events.createdAt,
            seenAt: seen.seenAt,
          })
          .from(events)
          .innerJoin(schema.conversations, eq(schema.conversations.id, events.conversationId))
          .innerJoin(schema.fans, eq(schema.fans.id, schema.conversations.fanId))
          .leftJoin(seen, and(eq(seen.creatorId, events.creatorId), eq(seen.eventId, events.id)))
          .where(
            and(
              isTrigger,
              filter.seen === undefined
                ? undefined
                : filter.seen
                  ? sql`${seen.eventId} is not null`
                  : sql`${seen.eventId} is null`,
              filter.alert === undefined ? undefined : alertIs(filter.alert),
              after === null ? undefined : sql`(${events.createdAt}, ${events.id}) < ${after}`,
            ),
          )
          .orderBy(sql`${events.createdAt} desc, ${events.id} desc`)
          .limit(page.limit + 1);
        const items = rows.slice(0, page.limit).map((row) => ({
          id: EventIdSchema.parse(row.id),
          conversationId: ConversationIdSchema.parse(row.conversationId),
          fanId: FanIdSchema.parse(row.fanId),
          fanDisplayName: row.fanDisplayName,
          trigger: TriggerPayloadSchema.parse(row.payload).trigger,
          pausedAgent: row.type === 'handoff_requested',
          at: row.at,
          seenAt: row.seenAt,
        }));
        const last = items.at(-1);
        return {
          items,
          nextCursor: rows.length > page.limit && last !== undefined ? encodeTriggerCursor(last.id) : null,
        };
      }),

    markSeen: (creatorId: CreatorId, id: EventId, userId: UserId) =>
      withTenant(db, creatorId, async (tx) => {
        const [found] = await tx
          .select({ id: events.id })
          .from(events)
          .where(and(eq(events.id, id), isTrigger));
        if (found === undefined) return false;
        await tx.insert(seen).values({ creatorId, eventId: id, seenBy: userId }).onConflictDoNothing();
        return true;
      }),

    markSeenUntil: (creatorId, untilId, filter, userId) =>
      withTenant(db, creatorId, async (tx) => {
        const until = await placeOf(tx, untilId);
        if (until === null) return null;
        const marked = await tx.execute(sql`
          insert into ${seen} (creator_id, event_id, seen_by)
          select ${events.creatorId}, ${events.id}, ${userId}
          from ${events}
          where ${isTrigger}
            and (${events.createdAt}, ${events.id}) <= ${until}
            ${filter.alert === undefined ? sql`` : sql`and ${alertIs(filter.alert)}`}
          on conflict do nothing
          returning event_id`);
        return marked.rows.length;
      }),
  };
}
