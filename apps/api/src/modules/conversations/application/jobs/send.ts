import {
  DomainError,
  MessageIdSchema,
  newId,
  type DraftStatus,
  type JobPayload,
  type MessageAuthor,
  type SendResult,
} from '@nirvana/contracts';

import { BLOCKED_EXPIRY_REASONS, SendRefused } from '../../domain/errors';
import type {
  Clock,
  Conversation,
  Draft,
  EventMeta,
  FollowUpPlan,
  JobLogger,
  OutboundSender,
  Transaction,
  UnitOfWork,
} from '../../domain/ports';
import { bubbleIdempotencyKey, canSend } from '../../domain/rules';
import { MAX_SEND_ATTEMPTS } from '../../domain/state-machine';
import { scheduleFollowUp } from '../follow-ups';
import { appendEvent, lockConversation, setDraftStatus } from '../journal';

export interface SendDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly sender: OutboundSender;
  /** Her follow-up delays (P3-10); without it, no follow-up is scheduled. */
  readonly followUps?: FollowUpPlan;
}

interface Sendable {
  readonly conversation: Conversation;
  readonly draft: Draft;
}

const SENDABLE: readonly DraftStatus[] = ['approved', 'edited'];

/**
 * `conversation.send` (message-flow.md §3), on the conversation's serial queue. Sends the approved bubbles one by
 * one, each with its own idempotency key, and records every step. Before each bubble it re-checks invariant 3: a
 * fan message or a takeover since the approval expires the draft and stops the send. A retry resumes after the
 * bubbles already recorded; an unknown outcome is checked with `verifySent` before trying again.
 */
export function createSendJob({ uow, clock, sender, followUps }: SendDeps) {
  const meta = (payload: JobPayload<'conversation.send'>): EventMeta => ({
    actor: 'system',
    correlationId: payload.correlationId,
    at: clock.now(),
  });

  /**
   * Locks both rows and checks the draft may still leave; expires it when it no longer may. Before a bubble goes
   * out (`beforeSending`), the kill switches and the session are read again too (message-flow.md §6): a draft
   * caught by them expires, so nothing leaves on its own once the switch is lifted.
   */
  async function lockSendable(
    tx: Transaction,
    payload: JobPayload<'conversation.send'>,
    beforeSending = false,
  ): Promise<Sendable | null> {
    const conversation = await lockConversation(tx, payload.conversationId);
    const draft = await tx.drafts.lock(payload.draftId);
    if (draft?.conversationId !== conversation.id || !SENDABLE.includes(draft.status)) return null;
    const check = {
      draftStatus: draft.status,
      draftCreatedAt: draft.createdAt,
      conversationState: conversation.state,
      lastInboundAt: conversation.lastInboundAt,
    };
    const blocked = beforeSending ? await tx.gate.blockedReason(conversation) : null;
    if (blocked === null && canSend(check)) return { conversation, draft };
    const at = meta(payload);
    const reason = blocked === null ? 'Plus valable à l’envoi' : BLOCKED_EXPIRY_REASONS[blocked];
    await appendEvent(
      tx,
      conversation,
      { type: 'draft_expired', payload: { draftId: draft.id, status: 'expired', reason } },
      at,
    );
    await setDraftStatus(tx, draft, 'expired', { decidedBy: null, at: at.at });
    return null;
  }

  /** The persona's delays, or none: a follow-up missed is better than a send that fails after it went out. */
  async function followUpDelays(
    payload: JobPayload<'conversation.send'>,
    logger: JobLogger,
  ): Promise<readonly number[]> {
    if (followUps === undefined) return [];
    try {
      return await followUps.delaysHours(payload.creatorId);
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.name : 'unknown' },
        'send: follow-up delays unreadable',
      );
      return [];
    }
  }

  return async (
    payload: JobPayload<'conversation.send'>,
    logger: JobLogger,
    attempt: number,
  ): Promise<void> => {
    const start = await uow.inTenant(payload.creatorId, async (tx) => {
      const sendable = await lockSendable(tx, payload, true);
      if (sendable === null) return null;
      return { ...sendable, alreadySent: await tx.messages.countForDraft(sendable.draft.id) };
    });
    if (start === null) {
      logger.info({ draftId: payload.draftId }, 'send: draft no longer sendable');
      return;
    }
    const bubbles = start.draft.finalBubbles ?? start.draft.bubbles;
    const author: MessageAuthor = start.draft.status === 'edited' ? 'human' : 'ai';

    for (let index = start.alreadySent; index < bubbles.length; index += 1) {
      const idempotencyKey = bubbleIdempotencyKey(payload.draftId, index);
      const text = bubbles[index] ?? '';
      const conversation = await uow.inTenant(payload.creatorId, async (tx) => {
        const sendable = await lockSendable(tx, payload, true);
        if (sendable === null) return null;
        await appendEvent(
          tx,
          sendable.conversation,
          {
            type: 'send_attempted',
            payload: {
              conversationId: payload.conversationId,
              draftId: payload.draftId,
              idempotencyKey,
              attempt,
            },
          },
          meta(payload),
        );
        return sendable.conversation;
      });
      if (conversation === null) {
        logger.info({ draftId: payload.draftId, index }, 'send: stopped, draft no longer sendable');
        return;
      }

      let result: SendResult | null;
      let failure: unknown = null;
      try {
        result = await sender.sendText(conversation, text, idempotencyKey);
      } catch (error) {
        failure = error;
        // The platform may have taken it before the error: ask before counting it as failed. A refused send never left.
        const verified =
          error instanceof SendRefused
            ? null
            : await sender.verifySent(conversation, idempotencyKey, null).catch(() => null);
        result =
          verified?.status === 'sent'
            ? { messageRef: verified.messageRef, sentAt: clock.now().toISOString() }
            : null;
      }

      if (result === null) {
        const code = failure instanceof DomainError ? failure.code : 'send_error';
        const isFinal = attempt >= MAX_SEND_ATTEMPTS || failure instanceof SendRefused;
        await uow.inTenant(payload.creatorId, async (tx) => {
          const sendable = await lockSendable(tx, payload);
          if (sendable === null) return;
          await appendEvent(
            tx,
            sendable.conversation,
            {
              type: 'send_failed',
              payload: {
                conversationId: payload.conversationId,
                draftId: payload.draftId,
                idempotencyKey,
                attempt,
                error: code,
                isFinal,
              },
            },
            meta(payload),
          );
          if (isFinal)
            await setDraftStatus(tx, sendable.draft, 'failed', { decidedBy: null, at: clock.now() });
        });
        logger.warn({ draftId: payload.draftId, index, attempt, code, isFinal }, 'send: failed');
        // Graphile retries with backoff until `maxAttempts`; the last failure leaves the conversation in `error`.
        if (!isFinal) throw failure instanceof Error ? failure : new Error(code);
        return;
      }

      const sent = result;
      await uow.inTenant(payload.creatorId, async (tx) => {
        const conversationNow = await lockConversation(tx, payload.conversationId);
        const messageId = newId(MessageIdSchema);
        const isNew = await tx.messages.insertIfNew({
          id: messageId,
          conversationId: conversationNow.id,
          platformAccountId: conversationNow.platformAccountId,
          platformMessageId: sent.messageRef.id,
          direction: 'outbound',
          author,
          text,
          priceMinor: null,
          currency: null,
          isPaid: false,
          platformCreatedAt: new Date(sent.sentAt),
          draftId: payload.draftId,
          platformMedia: [],
        });
        if (!isNew) return;
        await appendEvent(
          tx,
          conversationNow,
          {
            type: 'message_sent',
            payload: {
              messageId,
              platformMessageId: sent.messageRef.id,
              direction: 'outbound',
              author,
              mediaIds: [],
            },
          },
          meta(payload),
        );
      });
    }

    // Read before the lock, like the engine: the persona lives in another module.
    const delaysHours = await followUpDelays(payload, logger);
    await uow.inTenant(payload.creatorId, async (tx) => {
      const sendable = await lockSendable(tx, payload);
      if (sendable === null) return;
      const at = meta(payload);
      const sent = await appendEvent(
        tx,
        sendable.conversation,
        {
          type: 'send_verified',
          payload: {
            conversationId: payload.conversationId,
            draftId: payload.draftId,
            idempotencyKey: payload.draftId,
            attempt,
          },
        },
        at,
      );
      await setDraftStatus(tx, sendable.draft, 'sent', { decidedBy: null, at: clock.now() });
      // He has her answer: if he goes silent, she follows up (P3-10).
      await scheduleFollowUp(tx, sent, delaysHours, at);
    });
    logger.info({ draftId: payload.draftId, bubbles: bubbles.length }, 'send: verified');
  };
}
