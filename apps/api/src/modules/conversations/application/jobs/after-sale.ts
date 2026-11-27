import { DraftIdSchema, newId, type JobPayload } from '@impera/contracts';

import type {
  Clock,
  ComposeInput,
  ComposeResult,
  Conversation,
  DraftComposer,
  EventMeta,
  FanDirectory,
  HoldReason,
  JobLogger,
  ReplyHours,
  Transaction,
  UnitOfWork,
} from '../../domain/ports';
import { aftercareIdempotencyKey, followUpRetry } from '../../domain/rules';
import { appendEvent } from '../journal';

import { DEFAULT_CAUSES, fanNotesOf, handoffDetail, HISTORY_LIMIT } from './respond';

/** Holds of her word after a sale that still give the conversation to the chatters, as for a follow-up. */
const AFTERCARE_HANDOFFS: readonly HoldReason[] = ['guard_blocked', 'handoff'];

export interface AfterSaleDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly fans: Pick<FanDirectory, 'activeFacts'>;
  readonly composer?: DraftComposer;
  /** Her hours (P3-14): when her word may go out; without them, the defaults. */
  readonly replyHours?: ReplyHours;
}

/** Why her word after the sale is not written: nobody to thank, or the conversation is not hers to write in now. */
type Skip =
  | 'no_conversation'
  | 'not_idle'
  | 'fan_wrote'
  | 'already_written'
  | 'creator_archived'
  | 'kill_switch'
  | 'session_expired';

/**
 * Her word is still owed: the conversation rests (`idle`, no human, no pause, no error), he has not written since he
 * paid (his message is answered by `respond`, which reads the purchase in his history), no draft of hers for this sale
 * exists, and no gate is closed (message-flow.md §6). Read under the conversation's lock, before and after the engine.
 */
async function skipReason(
  tx: Transaction,
  conversation: Conversation,
  paidAt: Date,
  idempotencyKey: string,
): Promise<Skip | null> {
  if (conversation.state !== 'idle') return 'not_idle';
  if (conversation.lastInboundAt !== null && conversation.lastInboundAt > paidAt) return 'fan_wrote';
  if (await tx.drafts.existsWithKey(idempotencyKey)) return 'already_written';
  return tx.gate.blockedReason(conversation);
}

/**
 * `conversation.after_sale` (ADR 0156 § 2): a step he bought or a tip, read by the sales ledger, wakes his
 * conversation for a word of hers after it: thanks and tenderness, nothing to buy. The sale names his account and his
 * platform id: a fan nobody knows (a purchase the CRM reads before his messages are synced) wakes nothing and is
 * logged, never retried. Same three steps as `follow_up`: read under the lock, compose outside it, re-lock and write
 * unless something changed. It becomes a draft a human approves, never a send; a replay finds its draft written.
 * It runs outside the `conv:<id>` queue on purpose: the row lock and the idle re-check under it are enough, and a
 * word after a sale must not wait behind his answers (relecture Bilan de #903).
 */
export function createAfterSaleJob({ uow, clock, fans, composer, replyHours }: AfterSaleDeps) {
  return async (payload: JobPayload<'conversation.after_sale'>, logger: JobLogger): Promise<void> => {
    const paidAt = new Date(payload.occurredAt);
    const idempotencyKey = aftercareIdempotencyKey(payload.saleId);
    const meta = (): EventMeta => ({
      actor: 'system',
      correlationId: payload.correlationId,
      at: clock.now(),
    });

    const conversationId = await uow.inTenant(payload.creatorId, (tx) =>
      tx.conversations.idOfFan(payload.platformAccountId, payload.platformFanId),
    );
    if (conversationId === null) {
      // Seen at the first real reading of the CRM: a sale whose fan id matches none of the fans read in his messages.
      logger.info({ saleType: payload.saleType }, 'after_sale: no conversation for this fan');
      return;
    }
    if (composer === undefined) {
      logger.info({ saleType: payload.saleType }, 'after_sale: no engine');
      return;
    }

    const draftId = newId(DraftIdSchema);
    const read = await uow.inTenant(payload.creatorId, async (tx) => {
      const conversation = await tx.conversations.lock(conversationId);
      if (conversation === null) return null;
      const skip = await skipReason(tx, conversation, paidAt, idempotencyKey);
      if (skip !== null) {
        logger.info({ why: skip, saleType: payload.saleType }, 'after_sale: not written');
        return null;
      }
      return {
        conversation,
        history: await tx.messages.history(conversation.id, HISTORY_LIMIT),
        stats: await tx.messages.fanStats(conversation.fanId, clock.now()),
        scriptRun: await tx.scriptRuns.latest(conversation.id),
      };
    });
    if (read === null) return;

    const notes = await fans.activeFacts(read.conversation.creatorId, read.conversation.fanId);
    const hours = replyHours === undefined ? null : await replyHours.of(read.conversation.creatorId);
    const now = clock.now();
    const input: ComposeInput = {
      creatorId: read.conversation.creatorId,
      conversationId: read.conversation.id,
      fanId: read.conversation.fanId,
      draftId,
      correlationId: payload.correlationId,
      now,
      platformAccountId: read.conversation.platformAccountId,
      platformConversationId: read.conversation.platformConversationId,
      history: read.history,
      fan: { ...read.stats, ...fanNotesOf(notes, read.history) },
      aftercare: { saleType: payload.saleType, occurredAt: paidAt },
      // His run still open: the step he bought is not the end of it, her word stays in the moment (Charles, 20/11).
      scriptRun: read.scriptRun?.run ?? null,
      ...(hours !== null && { hours: hours.hours, exceptions: hours.exceptions }),
    };

    let result: ComposeResult;
    try {
      result = await composer.compose(input);
    } catch (error) {
      // No model reachable: her thanks are no emergency, they are simply not written.
      logger.warn({ err: error instanceof Error ? error.name : 'unknown' }, 'after_sale: composer failed');
      result = { kind: 'held', reason: 'no_reply', detail: ['composer_failed'], costUsd: 0 };
    }

    await uow.inTenant(payload.creatorId, async (tx) => {
      const conversation = await tx.conversations.lock(conversationId);
      if (conversation === null) return;
      const skip = await skipReason(tx, conversation, paidAt, idempotencyKey);
      if (skip !== null) {
        logger.info({ why: skip, saleType: payload.saleType }, 'after_sale: not written');
        return;
      }
      const at = meta();
      if (result.kind === 'draft') {
        await tx.drafts.insert({
          id: draftId,
          conversationId: conversation.id,
          idempotencyKey,
          createdAt: at.at,
          bubbles: result.bubbles,
          softViolations: result.softViolations,
          ...(result.voice !== undefined && { voice: result.voice }),
          ...(result.personaVersionId !== undefined && { personaVersionId: result.personaVersionId }),
          facts: [],
        });
        await appendEvent(
          tx,
          conversation,
          { type: 'draft_created', payload: { draftId, status: 'pending' } },
          { ...at, actor: 'ai' },
        );
        logger.info(
          { draftId, saleType: payload.saleType, bubbles: result.bubbles.length, costUsd: result.costUsd },
          'after_sale: draft created',
        );
        return;
      }
      // A guard or the engine's own call goes to a human, as for a follow-up.
      if (AFTERCARE_HANDOFFS.includes(result.reason)) {
        const detail = handoffDetail([result.reason, ...result.detail]);
        const cause = result.cause ?? DEFAULT_CAUSES[result.reason] ?? 'other';
        await appendEvent(
          tx,
          conversation,
          {
            type: 'handoff_requested',
            payload: { conversationId: conversation.id, cause, detail: [...detail] },
          },
          { ...at, actor: 'ai' },
        );
        logger.info({ reason: result.reason, costUsd: result.costUsd }, 'after_sale: handed over');
        return;
      }
      // Not now but later (her night): the same sale, at the time the engine gives.
      const retryAt = result.reason === 'no_reply' ? followUpRetry(result.retryAt, at.at) : null;
      if (retryAt !== null) {
        await tx.jobs.enqueue('conversation.after_sale', payload, {
          jobKey: `conversation.after_sale:${payload.saleId}`,
          runAt: retryAt,
        });
        logger.info({ detail: result.detail }, 'after_sale: put off');
        return;
      }
      logger.info({ reason: result.reason, detail: result.detail }, 'after_sale: not written');
    });
  };
}
