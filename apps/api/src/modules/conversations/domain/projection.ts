import {
  desireBandOf,
  type ConversationMode,
  type ConversationState,
  type DesireBand,
  type EventBody,
  type EventType,
  type FanAvailabilityRecord,
  type UserId,
} from '@impera/contracts';

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
  /** The last `fan_availability_changed` (ADR 0103, amendement du 13/11): his availability and the session's gate. */
  readonly fanAvailability: FanAvailabilityRecord | null;
  /**
   * The care mode (ADR 0088): when the open episode began (`care_opened`), when its help bubble went out in a draft,
   * and when the last episode was closed (`care_closed`). `careSince` null: no episode is open.
   */
  readonly careSince: Date | null;
  readonly careHelpAt: Date | null;
  readonly careClosedAt: Date | null;
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
  fanAvailability: null,
  careSince: null,
  careHelpAt: null,
  careClosedAt: null,
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
    if (event.payload.direction === 'inbound') return 'receive_inbound';
    // Read from the event, never from the state at replay (ADR 0007): the command saw him waiting (ADR 0110 § 2).
    return event.payload.answersFan === true ? 'answered_on_platform' : null;
  }
  if (event.type === 'send_failed') {
    // `isFinal` is absent from events written before it existed: the attempt count decides for them.
    const isFinal = event.payload.isFinal ?? event.payload.attempt >= MAX_SEND_ATTEMPTS;
    return isFinal ? 'send_failed_final' : null;
  }
  if (event.type === 'draft_expired' && event.payload.leavesFanWaiting === true) return 'expire_unanswered';
  // A draft refused while he still waited, as the command saw it (recette CHAT-25): the conversation stays with the
  // person who refused it, who answers in Reveal. Read from the event, never from the state at replay (ADR 0007).
  if (event.type === 'draft_rejected' && event.payload.leavesFanWaiting === true) return 'reject_unanswered';
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
  if (event.type === 'fan_availability_changed') {
    return { ...projection, state, fanAvailability: event.payload };
  }
  // An episode already open stays as it began: a second `care_opened` (another sign) does not move it.
  if (event.type === 'care_opened') {
    return { ...projection, state, careSince: projection.careSince ?? at };
  }
  if (event.type === 'care_closed') {
    return { ...projection, state, careSince: null, careHelpAt: null, careClosedAt: at };
  }
  if (event.type === 'draft_created' && event.payload.care?.help === true && projection.careSince !== null) {
    return { ...projection, state, careHelpAt: at };
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
