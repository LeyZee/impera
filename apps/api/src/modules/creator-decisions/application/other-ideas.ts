import type {
  CreatorDecision,
  CreatorDecisionId,
  CreatorDecisionKind,
  OtherIdeasBody,
} from '@impera/contracts';

import {
  DecisionIdeasPending,
  DecisionIdeasUnavailable,
  DecisionNoMoreIdeas,
  DecisionNotFound,
} from '../domain/errors';
import type { DecisionAsking, DecisionStore, OtherIdeasWriter } from '../domain/ports';

export interface OtherIdeasDeps {
  readonly store: Pick<DecisionStore, 'renewable'>;
  readonly asking: Pick<DecisionAsking, 'countIdeas' | 'returnIdeas' | 'otherIdeas'>;
  /** Who proposes other answers, by kind of decision; a kind without one never offers the gesture. */
  readonly writers: Partial<Record<CreatorDecisionKind, OtherIdeasWriter>>;
}

/**
 * « D'autres idées » (ADR 0164 § 9): she asks for other answers on a decision of hers still waiting, with a hint or a
 * few words. Her right is read in her own account. Her request is counted before anything is paid for it, one at a
 * time and three at most per decision: two touches at once pay once. The code that proposes for this kind then writes
 * the answers, which the door of the code that asks keeps. When nothing can be proposed, her request is given back.
 * Answered or withdrawn in between, the question is no longer found.
 */
export async function otherIdeas(
  deps: OtherIdeasDeps,
  userId: string,
  id: CreatorDecisionId,
  wish: OtherIdeasBody,
  now: Date,
): Promise<CreatorDecision> {
  const { creatorId, subject, decision } = await deps.store.renewable(userId, id, now);
  const writer = deps.writers[decision.kind];
  if (writer === undefined) throw new DecisionNoMoreIdeas();
  if (!(await deps.asking.countIdeas(creatorId, id, now))) throw new DecisionIdeasPending();
  let answers: Awaited<ReturnType<OtherIdeasWriter>>;
  try {
    answers = await writer({ creatorId, subject, shown: decision.answers, wish }, now);
  } catch (error) {
    await deps.asking.returnIdeas(creatorId, id);
    throw error;
  }
  if (answers === 'unavailable') {
    await deps.asking.returnIdeas(creatorId, id);
    throw new DecisionIdeasUnavailable();
  }
  const renewed = await deps.asking.otherIdeas(creatorId, id, answers);
  if (renewed === null) throw new DecisionNotFound();
  return renewed;
}
