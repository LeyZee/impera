import { jobKeyFor, queueNameFor } from '@nirvana/contracts';

import type { Conversation, EventMeta, Transaction } from '../domain/ports';
import { nextFollowUp } from '../domain/rules';

import { appendEvent } from './journal';

/** One pending follow-up per conversation: a later one replaces it (Graphile's `job_key`). */
export const followUpJobKey = (conversationId: string): string =>
  jobKeyFor('conversation.follow_up', conversationId);

/**
 * After her message reached him (P3-10): the next follow-up, if the persona has one still ahead of his last message,
 * on the conversation's serial queue. The caller holds the conversation's lock; a rollback drops the job with it.
 */
export async function scheduleFollowUp(
  tx: Transaction,
  conversation: Conversation,
  delaysHours: readonly number[],
  meta: EventMeta,
): Promise<void> {
  if (conversation.state !== 'idle') return;
  const anchor = conversation.lastInboundAt;
  const slot = nextFollowUp(anchor, delaysHours, meta.at);
  if (anchor === null || slot === null) return;
  await enqueueFollowUp(tx, conversation, { anchor, step: slot.step, runAt: slot.runAt }, meta);
}

/** Puts a follow-up in the conversation's queue, replacing the pending one, and says so in the journal. */
export async function enqueueFollowUp(
  tx: Transaction,
  conversation: Conversation,
  slot: { readonly anchor: Date; readonly step: number; readonly runAt: Date },
  meta: EventMeta,
): Promise<void> {
  const { anchor } = slot;
  const jobKey = followUpJobKey(conversation.id);
  await tx.jobs.enqueue(
    'conversation.follow_up',
    {
      creatorId: conversation.creatorId,
      conversationId: conversation.id,
      correlationId: meta.correlationId,
      anchorAt: anchor.toISOString(),
      step: slot.step,
    },
    { queueName: queueNameFor(conversation.id), jobKey, runAt: slot.runAt },
  );
  await appendEvent(
    tx,
    conversation,
    { type: 'follow_up_scheduled', payload: { jobKey, runAt: slot.runAt.toISOString() } },
    meta,
  );
}
