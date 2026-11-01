import type { Conversation } from './ports';
import type { ConversationProjection } from './projection';

/** The projection columns of a conversation row, without its identity. */
export function projectionOf(conversation: Conversation): ConversationProjection {
  return {
    state: conversation.state,
    mode: conversation.mode,
    lastInboundAt: conversation.lastInboundAt,
    lastOutboundAt: conversation.lastOutboundAt,
    unreadCount: conversation.unreadCount,
    routedToUserId: conversation.routedToUserId,
    desireScore: conversation.desireScore,
    desireBand: conversation.desireBand,
    desireAt: conversation.desireAt,
  };
}
