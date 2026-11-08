import { AuditEntryIdSchema, newId, type ConversationId } from '@impera/contracts';
import { schema, sql, type Transaction } from '@impera/db';
import { z } from 'zod';

/**
 * How long an opening covers the same account's reads of the same conversation: past it, a read is written as an
 * opening again. The screens read a conversation every 30 s while it is open; a direct call, with no opening, is
 * written at once (ADR 0042 § 2 for the creator, ADR 0025 for a chatter).
 */
const READ_TRACE_MINUTES = 15;

/** Who opened it: the creator from her space, or a chatter whose scope is `self` (never the content read). */
export type OpenedBy = 'creator' | 'chatter';

/**
 * The read written as an opening when no opening covers it: the thread, the journal or the desire curve, or the fan's
 * sheet read on its own (his limits, what is left to learn), or the copilot panel of the extension (ADR 0086 § 7).
 */
export type ReadVia = 'messages' | 'events' | 'desire' | 'flags' | 'kyc' | 'card' | 'copilot';

/** An opening of a conversation, in the audit log, without what was read (ADR 0042 § 2, ADR 0025). */
export async function writeOpening(
  tx: Transaction,
  entry: { userId: string; id: ConversationId; ip: string; creatorId: string; by: OpenedBy; via?: ReadVia },
): Promise<void> {
  const { via, by, ...rest } = entry;
  await tx.insert(schema.auditLog).values({
    id: newId(AuditEntryIdSchema),
    userId: rest.userId,
    action: 'conversation.open',
    entity: 'conversation',
    entityId: rest.id,
    ip: rest.ip,
    details: via === undefined ? { creatorId: rest.creatorId, by } : { creatorId: rest.creatorId, by, via },
  });
}

/** Whether that account opened that conversation, by any route, in the last `READ_TRACE_MINUTES`. */
export async function openedLately(tx: Transaction, userId: string, id: ConversationId): Promise<boolean> {
  const result = await tx.execute(sql`
    select exists (
      select 1 from ${schema.auditLog}
       where ${schema.auditLog.userId} = ${userId}
         and ${schema.auditLog.action} = 'conversation.open'
         and ${schema.auditLog.entityId} = ${id}
         and ${schema.auditLog.createdAt} > now() - make_interval(mins => ${READ_TRACE_MINUTES})
    ) as opened`);
  return z.array(z.object({ opened: z.boolean() })).parse(result.rows)[0]?.opened === true;
}
