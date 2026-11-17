import {
  DomainError,
  MessageIdSchema,
  newId,
  type DraftStatus,
  type JobPayload,
  type MessageAuthor,
  type SendResult,
} from '@impera/contracts';

import { BLOCKED_EXPIRY_REASONS, SendRefused, stepCutExpiryReason } from '../../domain/errors';
import type {
  Clock,
  Conversation,
  Draft,
  EventMeta,
  FollowUpPlan,
  JobLogger,
  OutboundSender,
  Transaction,
  TypingRhythm,
  UnitOfWork,
} from '../../domain/ports';
import { bubbleIdempotencyKey, canSend, fanAwaitsAnswer, stepCutBy } from '../../domain/rules';
import { MAX_SEND_ATTEMPTS } from '../../domain/state-machine';
import { scheduleFollowUp } from '../follow-ups';
import { appendEvent, lockConversation, setDraftStatus } from '../journal';

export interface SendDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly sender: OutboundSender;
  /** Her follow-up delays (P3-10); without it, no follow-up is scheduled. */
  readonly followUps?: FollowUpPlan;
  /** Her typing rhythm: before each bubble after the first, the time to type it. Without it, none. */
  readonly typing?: TypingRhythm;
}

interface Sendable {
  readonly conversation: Conversation;
  readonly draft: Draft;
}

const SENDABLE: readonly DraftStatus[] = ['approved', 'edited'];
/** Reveal sells in euros: a step's price is in cents (ADR 0098 § 5). */
const STEP_CURRENCY = 'EUR';

/**
 * `conversation.send` (message-flow.md §3), on the conversation's serial queue. Sends the approved bubbles one by
 * one, each with its own idempotency key, and records every step. Before each bubble it re-checks invariant 3: a
 * fan message or a takeover since the approval expires the draft and stops the send. A retry resumes after the
 * bubbles already recorded; an unknown outcome is checked with `verifySent` before trying again.
 */
export function createSendJob({ uow, clock, sender, followUps, typing }: SendDeps) {
  const meta = (payload: JobPayload<'conversation.send'>): EventMeta => ({
    actor: 'system',
    correlationId: payload.correlationId,
    at: clock.now(),
  });

  /**
   * Locks both rows and checks the draft may still leave; expires it when it no longer may. Before a bubble goes
   * out (`beforeSending`), the kill switches and the session are read again too (message-flow.md §6): a draft
   * caught by them expires, so nothing leaves on its own once the switch is lifted; a fan it leaves unanswered keeps
   * the conversation waiting, and the resume drafts his answer again.
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
    // Stopped before anything answered the fan: the conversation waits again, so the resume answers him (MOT-03).
    const leavesFanWaiting = blocked !== null && fanAwaitsAnswer(conversation);
    await appendEvent(
      tx,
      conversation,
      {
        type: 'draft_expired',
        payload: {
          draftId: draft.id,
          status: 'expired',
          reason,
          ...(leavesFanWaiting && { leavesFanWaiting: true }),
        },
      },
      at,
    );
    await setDraftStatus(tx, draft, 'expired', { decidedBy: null, at: at.at });
    return null;
  }

  /** Expires the draft when his limits now keep its paid step; `true` when they do. */
  async function expiredForStep(
    tx: Transaction,
    { conversation, draft }: Sendable,
    payload: JobPayload<'conversation.send'>,
  ): Promise<boolean> {
    const cut = stepCutBy(await tx.gate.fanFlags(conversation), conversation.careSince);
    if (cut === null) return false;
    const at = meta(payload);
    await appendEvent(
      tx,
      conversation,
      {
        type: 'draft_expired',
        payload: { draftId: draft.id, status: 'expired', reason: stepCutExpiryReason(cut) },
      },
      at,
    );
    await setDraftStatus(tx, draft, 'expired', { decidedBy: null, at: at.at });
    return true;
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
    // The first bubble leaves when the reply is due; each next one after the time she takes to type it. A message of
    // his meanwhile expires the draft at the check below, and the rest never leaves.
    const typingMs = typing?.delaysMs(bubbles) ?? [];

    // The step of her script decided with the draft leaves last, once the bubbles that bring it are out (ADR 0098).
    const step = start.draft.scriptStep;
    const total = bubbles.length + (step === null ? 0 : 1);

    for (let index = start.alreadySent; index < total; index += 1) {
      const isStep = step !== null && index === bubbles.length;
      const idempotencyKey = isStep ? step.idempotencyKey : bubbleIdempotencyKey(payload.draftId, index);
      const text = isStep ? '' : (bubbles[index] ?? '');
      const pause = index > 0 && !isStep ? (typingMs[index] ?? 0) : 0;
      if (pause > 0 && typing !== undefined) await typing.wait(pause);
      const conversation = await uow.inTenant(payload.creatorId, async (tx) => {
        const sendable = await lockSendable(tx, payload, true);
        if (sendable === null) return null;
        // His limits, read again before the paid step: one set since the approval keeps it, the bubbles already
        // gone stay, and the draft expires so no retry sends it (relecture Sécurité de #812).
        if (isStep && (await expiredForStep(tx, sendable, payload))) return null;
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
        result = isStep
          ? await sender.sendStep(
              conversation,
              { scriptRef: step.scriptRef, stepRef: step.stepRef },
              { amountMinor: step.priceMinor, currency: STEP_CURRENCY },
              idempotencyKey,
            )
          : await sender.sendText(conversation, text, idempotencyKey);
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
          // A paid step is priced as the platform sells it; it is paid once the platform says he bought it.
          priceMinor: isStep && step.priceMinor > 0 ? step.priceMinor : null,
          currency: isStep && step.priceMinor > 0 ? STEP_CURRENCY : null,
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
    logger.info(
      { draftId: payload.draftId, bubbles: bubbles.length, scriptStep: step !== null },
      'send: verified',
    );
  };
}
