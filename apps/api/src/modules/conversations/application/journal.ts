import type { ConversationId, DraftId, DraftStatus, EventBody, EventType } from '@nirvana/contracts';

import { projectionOf } from '../domain/conversation';
import { ConversationNotFound, DraftConflict, DraftNotFound, TransitionConflict } from '../domain/errors';
import type { Conversation, Draft, DraftDecision, EventMeta, Transaction } from '../domain/ports';
import { applyEvent, commandFor } from '../domain/projection';
import { canDraftBecome, nextState } from '../domain/state-machine';

/**
 * Events other modules react to (`supervision` notifies on a new draft, `telegram` opens and closes alerts and
 * tells the alerts that only let a human know): also written to the outbox. Only the last failure of a send is
 * news; the retries before it stay in the journal.
 */
const PUBLISHED: ReadonlySet<EventType> = new Set([
  'draft_created',
  'message_sent',
  'handoff_requested',
  'alert_triggered',
  'takeover_started',
  'takeover_ended',
  'send_failed',
]);

function isPublished(body: EventBody): boolean {
  if (body.type === 'send_failed') return body.payload.isFinal === true;
  return PUBLISHED.has(body.type);
}

/**
 * The only way the module writes an event (ADR 0007): checks the transition, appends to the journal, writes the
 * projection the same event gives, and copies it to the outbox when other modules listen. All in the caller's
 * transaction, which holds the conversation's lock: no state without its event, no event without its state.
 */
export async function appendEvent(
  tx: Transaction,
  conversation: Conversation,
  body: EventBody,
  meta: EventMeta,
): Promise<Conversation> {
  const command = commandFor(body);
  if (command !== null && nextState(conversation.state, command) === null) {
    throw new TransitionConflict(conversation.state, command);
  }
  await tx.events.append(conversation, body, meta);
  const projection = applyEvent(projectionOf(conversation), body, meta.at);
  await tx.conversations.saveProjection(conversation.id, projection);
  if (isPublished(body)) await tx.events.publish(conversation.creatorId, body, meta);
  return { ...conversation, ...projection };
}

/** Locks the conversation for the rest of the transaction. */
export async function lockConversation(tx: Transaction, id: ConversationId): Promise<Conversation> {
  const conversation = await tx.conversations.lock(id);
  if (conversation === null) throw new ConversationNotFound();
  return conversation;
}

/** Locks a draft of this conversation and checks it may take `to`. */
export async function lockDraftFor(
  tx: Transaction,
  conversation: Conversation,
  draftId: DraftId,
  to: DraftStatus,
): Promise<Draft> {
  const draft = await tx.drafts.lock(draftId);
  if (draft?.conversationId !== conversation.id) throw new DraftNotFound();
  if (!canDraftBecome(draft.status, to)) throw new DraftConflict(draft.status, to);
  return draft;
}

export async function setDraftStatus(
  tx: Transaction,
  draft: Draft,
  to: DraftStatus,
  decision?: DraftDecision,
): Promise<void> {
  if (!canDraftBecome(draft.status, to)) throw new DraftConflict(draft.status, to);
  await tx.drafts.setStatus(draft.id, to, decision);
}
