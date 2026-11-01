import {
  desireBandOf,
  type ConversationMode,
  type ConversationState,
  type DesireBand,
  type EventBody,
  type EventType,
  type UserId,
} from '@nirvana/contracts';

import { MAX_SEND_ATTEMPTS, nextState, type ConversationCommand } from './state-machine';

/** The columns of `conversations` that are projections of the journal (ADR 0007). */
export interface ConversationProjection {
  readonly state: ConversationState;
  readonly mode: ConversationMode;
  readonly lastInboundAt: Date | null;
  readonly lastOutboundAt: Date | null;
  readonly unreadCount: number;
  /**
   * The team member the conversation is routed to (ADR 0024, ADR 0025): the routing event comes with EQ-08, and
   * « Rendre la main » clears it, so a routed conversation never stays open to him outside his shift.
   */
  readonly routedToUserId: UserId | null;
  /** The last `desire_scored` (P3-12): its score, the band of that score, and when the engine computed it. */
  readonly desireScore: number | null;
  readonly desireBand: DesireBand | null;
  readonly desireAt: Date | null;
}

export const INITIAL_PROJECTION: ConversationProjection = {
  state: 'idle',
  mode: 'copilot',
  lastInboundAt: null,
  lastOutboundAt: null,
  unreadCount: 0,
  routedToUserId: null,
  desireScore: null,
  desireBand: null,
  desireAt: null,
};

/** Events that move the state whatever their payload. */
const COMMANDS: Readonly<Partial<Record<EventType, ConversationCommand>>> = {
  draft_created: 'create_draft',
  draft_approved: 'approve',
  draft_edited: 'approve',
  draft_rejected: 'reject',
  draft_expired: 'expire',
  send_verified: 'send_verified',
  takeover_started: 'takeover',
  handoff_requested: 'handoff',
  reply_skipped: 'skip_reply',
  takeover_ended: 'release',
};

/** The state-machine command an event stands for, if it moves the state. */
export function commandFor(event: EventBody): ConversationCommand | null {
  if (event.type === 'message_received') {
    return event.payload.direction === 'inbound' ? 'receive_inbound' : null;
  }
  if (event.type === 'send_failed') {
    // `isFinal` is absent from events written before it existed: the attempt count decides for them.
    const isFinal = event.payload.isFinal ?? event.payload.attempt >= MAX_SEND_ATTEMPTS;
    return isFinal ? 'send_failed_final' : null;
  }
  return COMMANDS[event.type] ?? null;
}

/**
 * Applies one event to the projection. Commands use it to compute the row they write, and the rebuild folds the
 * whole journal with it: both paths give the same result by construction.
 */
export function applyEvent(
  projection: ConversationProjection,
  event: EventBody,
  at: Date,
): ConversationProjection {
  const command = commandFor(event);
  const state =
    command === null ? projection.state : (nextState(projection.state, command) ?? projection.state);
  if (event.type === 'message_received' && event.payload.direction === 'inbound') {
    return { ...projection, state, lastInboundAt: at, unreadCount: projection.unreadCount + 1 };
  }
  if (event.type === 'message_received' || event.type === 'message_sent') {
    return { ...projection, state, lastOutboundAt: at, unreadCount: 0 };
  }
  if (event.type === 'takeover_ended') {
    return { ...projection, state, routedToUserId: null };
  }
  if (event.type === 'desire_scored') {
    const score = event.payload.score;
    return { ...projection, state, desireScore: score, desireBand: desireBandOf(score), desireAt: at };
  }
  if (event.type === 'mode_changed') {
    return { ...projection, state, mode: event.payload.mode ?? projection.mode };
  }
  return { ...projection, state };
}

export function rebuildProjection(
  events: readonly { readonly body: EventBody; readonly at: Date }[],
): ConversationProjection {
  return events.reduce(
    (projection, event) => applyEvent(projection, event.body, event.at),
    INITIAL_PROJECTION,
  );
}
