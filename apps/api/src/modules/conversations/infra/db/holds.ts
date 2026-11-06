import { schema, sql } from '@impera/db';

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

/**
 * Who holds the row of `conversations` in scope, for the user `userId` (EQ-13): `'you'` where `heldBy(userId)` is true,
 * `'other'` where another person holds it the same way (routed to them, or their takeover is the last word), `null`
 * where nobody does: the agent, or a handoff no person took. The last word on the hand is read once per row.
 */
export function holderFor(userId: SQL): SQL {
  return sql`(select case
      when h.routed = ${userId}::text or h.taker = ${userId}::text then 'you'
      when h.routed is not null or h.taker is not null then 'other'
    end
    from (select ${conversations.routedToUserId}::text as routed, (case when ${conversations.state} = 'human' then (
      select case when e.type = 'takeover_started' then e.payload->>'userId' end
      from ${conversationEvents} e
      where e.conversation_id = ${conversations.id}
        and e.type in ('takeover_started', 'takeover_ended', 'handoff_requested')
      order by e.seq desc
      limit 1
    ) end) as taker) h)`;
}
