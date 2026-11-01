import type { ConversationState, DraftStatus } from '@nirvana/contracts';

/**
 * What can happen to a conversation, and where it leads (message-flow.md). `drafting` is reserved for the engine
 * (P3): until then a draft is written in the same transaction that leaves `pending`. The same table drives the commands
 * and the rebuild of projections from the journal, so a state can always be explained by events.
 */
export type ConversationCommand =
  | 'receive_inbound'
  | 'create_draft'
  | 'approve'
  | 'reject'
  | 'expire'
  | 'send_verified'
  | 'send_failed_final'
  | 'takeover'
  | 'handoff'
  | 'skip_reply'
  | 'release';

type Transitions = Readonly<Partial<Record<ConversationState, ConversationState>>>;

const TRANSITIONS: Readonly<Record<ConversationCommand, Transitions>> = {
  // A fan writes: the bot has something to answer, unless a human holds the conversation or it is stuck.
  receive_inbound: {
    idle: 'pending',
    pending: 'pending',
    drafting: 'pending',
    awaiting_approval: 'pending',
    sending: 'pending',
    human: 'human',
    paused: 'paused',
    error: 'error',
  },
  // From `idle` too: a follow-up to a fan who went silent after her answer (P3-10).
  create_draft: { pending: 'awaiting_approval', idle: 'awaiting_approval' },
  approve: { awaiting_approval: 'sending' },
  reject: { awaiting_approval: 'idle' },
  // A draft that is no longer valid; a fan message that caused it already moved the conversation to pending.
  expire: { awaiting_approval: 'idle', pending: 'pending', sending: 'idle' },
  send_verified: { sending: 'idle', pending: 'pending' },
  send_failed_final: { sending: 'error', pending: 'error' },
  // From `human` too: a chatter takes a conversation the engine handed over, which closes its alert (ADR 0020).
  takeover: {
    idle: 'human',
    pending: 'human',
    drafting: 'human',
    awaiting_approval: 'human',
    sending: 'human',
    paused: 'human',
    error: 'human',
    human: 'human',
  },
  // The engine hands the conversation to the chatters (guard, budget, its own call): same reach as a takeover,
  // except a conversation a human already holds.
  handoff: {
    idle: 'human',
    pending: 'human',
    drafting: 'human',
    awaiting_approval: 'human',
    sending: 'human',
    paused: 'human',
    error: 'human',
  },
  // The engine has nothing to say, or no model answered: the fan's next message starts again.
  skip_reply: { pending: 'idle', drafting: 'idle' },
  release: { human: 'idle', error: 'idle' },
};

/** The state after `command`, or `null` when the command is not allowed in `state`. */
export function nextState(state: ConversationState, command: ConversationCommand): ConversationState | null {
  return TRANSITIONS[command][state] ?? null;
}

const DRAFT_TRANSITIONS: Readonly<Record<DraftStatus, readonly DraftStatus[]>> = {
  pending: ['approved', 'edited', 'rejected', 'expired'],
  approved: ['sent', 'failed', 'expired'],
  edited: ['sent', 'failed', 'expired'],
  rejected: [],
  sent: [],
  failed: [],
  expired: [],
};

export function canDraftBecome(from: DraftStatus, to: DraftStatus): boolean {
  return DRAFT_TRANSITIONS[from].includes(to);
}

/** Sends tried per draft before the conversation goes to `error` and waits for a human (message-flow.md §3). */
export const MAX_SEND_ATTEMPTS = 3;
