import { DraftIdSchema, newId, type JobPayload } from '@nirvana/contracts';

import type {
  Clock,
  ComposeInput,
  ComposeResult,
  Conversation,
  DraftComposer,
  EventMeta,
  FanDirectory,
  FollowUpPlan,
  HoldReason,
  JobLogger,
  ReplyHours,
  Transaction,
  UnitOfWork,
} from '../../domain/ports';
import { followUpIdempotencyKey, followUpRetry } from '../../domain/rules';
import { readProposedFacts } from '../facts';
import { enqueueFollowUp, followUpJobKey } from '../follow-ups';
import { appendEvent } from '../journal';

import { DEFAULT_CAUSES, handoffDetail, HISTORY_LIMIT, noteLine } from './respond';

/** Holds of a follow-up that still give the conversation to the chatters. */
const FOLLOW_UP_HANDOFFS: readonly HoldReason[] = ['guard_blocked', 'handoff'];

export interface FollowUpDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly fans: Pick<FanDirectory, 'activeFacts'>;
  readonly composer?: DraftComposer;
  readonly followUps?: FollowUpPlan;
  /** Her hours (P3-14): when a follow-up may go out; without them, the defaults. */
  readonly replyHours?: ReplyHours;
}

/** Why a follow-up does not go out: the silence it was for is over, or nothing may be written now. */
type Stale =
  | 'not_found'
  | 'not_idle'
  | 'fan_wrote'
  | 'not_answered'
  | 'plan_changed'
  | 'kill_switch'
  | 'session_expired';

/**
 * The follow-up is still owed: the conversation rests (`idle`, no human, no pause, no error), his last message is
 * still the one the delays count from, her answer came after it, the persona still has this step, and no gate is
 * closed (message-flow.md §6). Read under the conversation's lock, before and after the engine.
 */
async function staleReason(
  tx: Transaction,
  conversation: Conversation | null,
  anchor: Date,
  step: number,
  steps: number,
): Promise<Stale | null> {
  if (conversation === null) return 'not_found';
  if (conversation.state !== 'idle') return 'not_idle';
  if (conversation.lastInboundAt?.getTime() !== anchor.getTime()) return 'fan_wrote';
  if (conversation.lastOutboundAt === null || conversation.lastOutboundAt < anchor) return 'not_answered';
  if (step >= steps) return 'plan_changed';
  return tx.gate.blockedReason(conversation);
}

/**
 * `conversation.follow_up` (P3-10), on the conversation's serial queue at the delay of `persona.follow_ups`. Same
 * three steps as `respond`: read under the lock, compose outside it, re-lock and write unless something changed.
 * The engine decides whether a follow-up goes out and writes it; it becomes a draft a human approves, never a send.
 * A follow-up that no longer applies is cancelled with `follow_up_cancelled`; a replay finds its draft written.
 */
export function createFollowUpJob({ uow, clock, fans, composer, followUps, replyHours }: FollowUpDeps) {
  return async (payload: JobPayload<'conversation.follow_up'>, logger: JobLogger): Promise<void> => {
    const anchor = new Date(payload.anchorAt);
    const jobKey = followUpJobKey(payload.conversationId);
    const meta = (): EventMeta => ({
      actor: 'system',
      correlationId: payload.correlationId,
      at: clock.now(),
    });

    /** Records why nothing goes out, in the journal of a conversation that still exists. */
    async function cancel(tx: Transaction, conversation: Conversation | null, why: string): Promise<void> {
      logger.info({ why, step: payload.step }, 'follow_up: cancelled');
      if (conversation === null) return;
      await appendEvent(tx, conversation, { type: 'follow_up_cancelled', payload: { jobKey } }, meta());
    }

    let steps = 0;
    if (composer !== undefined && followUps !== undefined) {
      try {
        steps = (await followUps.delaysHours(payload.creatorId)).length;
      } catch (error) {
        logger.warn({ err: error instanceof Error ? error.name : 'unknown' }, 'follow_up: delays unreadable');
        // Thrown again: Graphile retries, the follow-up is not lost to a passing failure.
        throw error;
      }
    }
    const draftId = newId(DraftIdSchema);
    const read = await uow.inTenant(payload.creatorId, async (tx) => {
      const conversation = await tx.conversations.lock(payload.conversationId);
      if (composer === undefined) {
        await cancel(tx, conversation, 'no_engine');
        return null;
      }
      const stale = await staleReason(tx, conversation, anchor, payload.step, steps);
      if (stale !== null || conversation === null) {
        await cancel(tx, conversation, stale ?? 'not_found');
        return null;
      }
      return {
        conversation,
        history: await tx.messages.history(conversation.id, HISTORY_LIMIT),
        stats: await tx.messages.fanStats(conversation.fanId),
      };
    });
    if (read === null || composer === undefined) return;

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
      fan: { ...read.stats, notes: notes.map(noteLine) },
      followUp: { step: payload.step, steps, silentSince: anchor },
      ...(hours !== null && { hours: hours.hours }),
    };
    const source = read.history.findLast((message) => message.author === 'fan') ?? null;

    let result: ComposeResult;
    try {
      result = await composer.compose(input);
    } catch (error) {
      // No model reachable: a silent fan is no emergency, the follow-up is simply not written.
      logger.warn({ err: error instanceof Error ? error.name : 'unknown' }, 'follow_up: composer failed');
      result = { kind: 'held', reason: 'no_reply', detail: ['composer_failed'], costUsd: 0 };
    }

    await uow.inTenant(payload.creatorId, async (tx) => {
      const conversation = await tx.conversations.lock(payload.conversationId);
      const stale = await staleReason(tx, conversation, anchor, payload.step, steps);
      if (stale !== null || conversation === null) {
        await cancel(tx, conversation, stale ?? 'not_found');
        return;
      }
      const at = meta();
      if (result.kind === 'draft') {
        await tx.drafts.insert({
          id: draftId,
          conversationId: conversation.id,
          idempotencyKey: followUpIdempotencyKey(conversation.id, anchor, payload.step),
          createdAt: at.at,
          bubbles: result.bubbles,
          softViolations: result.softViolations,
          ...(result.voice !== undefined && { voice: result.voice }),
          ...(result.personaVersionId !== undefined && { personaVersionId: result.personaVersionId }),
          facts: readProposedFacts(result.factsProposed ?? [], source, now),
        });
        await appendEvent(
          tx,
          conversation,
          { type: 'draft_created', payload: { draftId, status: 'pending' } },
          { ...at, actor: 'ai' },
        );
        logger.info(
          { draftId, step: payload.step, bubbles: result.bubbles.length, costUsd: result.costUsd },
          'follow_up: draft created',
        );
        return;
      }
      // A guard or the engine's own call goes to a human, as after a fan message. No model or no budget for a silent
      // fan is no emergency: the follow-up is simply not written.
      if (FOLLOW_UP_HANDOFFS.includes(result.reason)) {
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
        logger.info({ reason: result.reason, costUsd: result.costUsd }, 'follow_up: handed over');
        return;
      }
      // Not now but later (her night): the same step, at the time the engine gives.
      const retryAt = result.reason === 'no_reply' ? followUpRetry(result.retryAt, at.at) : null;
      if (retryAt !== null) {
        await enqueueFollowUp(tx, conversation, { anchor, step: payload.step, runAt: retryAt }, at);
        logger.info({ step: payload.step, detail: result.detail }, 'follow_up: put off');
        return;
      }
      await cancel(tx, conversation, result.reason);
    });
  };
}
