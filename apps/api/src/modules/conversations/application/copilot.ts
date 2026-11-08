import type {
  ConversationId,
  CopilotVerdictBody,
  CopilotVerdictResult,
  CreatorId,
  DraftId,
  DraftStatus,
  UserId,
} from '@impera/contracts';

import { CopilotDraftConflict, DraftConflict, DraftNotFound } from '../domain/errors';
import type { Clock, UnitOfWork } from '../domain/ports';

import type { ConversationCommands } from './commands';

export interface CopilotGestureDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly commands: Pick<ConversationCommands, 'rejectDraft'>;
}

export interface CopilotGesture {
  readonly creatorId: CreatorId;
  readonly draftId: DraftId;
  readonly userId: UserId;
  readonly body: CopilotVerdictBody;
  readonly correlationId: string;
}

/** The draft's status and conversation, read under its lock; 404 for a draft she does not have. */
async function draftOf(
  deps: CopilotGestureDeps,
  creatorId: CreatorId,
  draftId: DraftId,
): Promise<{ readonly status: DraftStatus; readonly conversationId: ConversationId }> {
  const draft = await deps.uow.inTenant(creatorId, (tx) => tx.drafts.lock(draftId));
  if (draft === null) throw new DraftNotFound();
  return { status: draft.status, conversationId: draft.conversationId };
}

/**
 * The chatter's gesture from the copilot panel (ADR 0086 § 4), one per draft (§ 8: replayed, it creates nothing).
 * `placed` marks the draft put in the platform's field: it stays pending, and what leaves decides its verdict (§ 5).
 * `rejected` rejects it as Suivi would, with its `live` rating in the same transaction. A rejection after a placing is
 * accepted (he placed it, then wrote his own); a placing after a rejection, or on a draft settled otherwise, is 409.
 */
export async function recordCopilotGesture(
  deps: CopilotGestureDeps,
  gesture: CopilotGesture,
): Promise<CopilotVerdictResult> {
  const { creatorId, draftId, userId, body } = gesture;
  if (body.kind === 'placed') {
    return deps.uow.inTenant(creatorId, async (tx) => {
      const draft = await tx.drafts.lock(draftId);
      if (draft === null) throw new DraftNotFound();
      if (draft.status !== 'pending') throw new CopilotDraftConflict();
      const placed = await tx.drafts.place(draftId, userId, deps.clock.now());
      if (placed)
        await tx.audit.record({
          userId,
          action: 'draft.placed',
          entityId: draft.conversationId,
          details: { draftId, edited: body.edited },
        });
      return { draftId, outcome: 'placed', replayed: !placed };
    });
  }
  const replayed = { draftId, outcome: 'rejected', replayed: true } as const;
  const before = await draftOf(deps, creatorId, draftId);
  if (before.status === 'rejected') return replayed;
  if (before.status !== 'pending') throw new CopilotDraftConflict();
  try {
    await deps.commands.rejectDraft({
      creatorId,
      conversationId: before.conversationId,
      userId,
      correlationId: gesture.correlationId,
      draftId,
      // His own words, if any, in the conversation's history; the closed reason goes to the rating.
      ...(body.note === undefined ? {} : { reason: body.note }),
      live: {
        kind: 'rejected',
        reason: body.reason,
        ...(body.note === undefined ? {} : { note: body.note }),
      },
    });
  } catch (error) {
    // The same gesture sent twice at once: the second finds it rejected, and creates nothing.
    if (!(error instanceof DraftConflict)) throw error;
    if ((await draftOf(deps, creatorId, draftId)).status === 'rejected') return replayed;
    throw new CopilotDraftConflict();
  }
  return { draftId, outcome: 'rejected', replayed: false };
}
