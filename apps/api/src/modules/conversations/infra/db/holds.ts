import { schema, sql } from '@nirvana/db';

const { conversationEvents, conversations } = schema;

type SQL = ReturnType<typeof sql>;

/**
 * Whether the user `userId` holds the row of `conversations` in scope (EQ-13): it is routed to him, or it is in `human`
 * and his `takeover_started` is the last word on who holds it, no `takeover_ended` nor `handoff_requested` since. One
 * condition for the tenant's check under the lock and for the admin's read across creators.
 */
export function heldBy(userId: SQL): SQL {
  return sql`(${conversations.routedToUserId} = ${userId} or (${conversations.state} = 'human' and coalesce((
    select e.type = 'takeover_started' and e.payload->>'userId' = ${userId}
    from ${conversationEvents} e
    where e.conversation_id = ${conversations.id}
      and e.type in ('takeover_started', 'takeover_ended', 'handoff_requested')
    order by e.seq desc
    limit 1
  ), false)))`;
}
