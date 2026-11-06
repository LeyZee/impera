import type { JobPayload } from '@impera/contracts';

import type { IdeaContentRequest } from '../../content-drops';
import type { IdeaFollowStore } from '../domain/ports';

export interface FollowDeps {
  readonly ideas: IdeaFollowStore;
  /** The content request's own door (`content-drops` index): the trend watch writes no table of hers. */
  readonly requestFromIdea: (request: IdeaContentRequest) => Promise<void>;
}

/**
 * `creator_tasks.suggestion_decided` (VEI-01 d2): her gesture on the shoot an idea became. Accepted, the content
 * request is asked for the day of her shoot (ADR 0055 § 4), under the idea's id, then recorded on the idea; declined,
 * the idea is `declined`. A suggestion that no idea became, or an idea of another creator, asks nothing.
 * Replayable: the request is written once under its id, the idea moves only from `suggested`.
 */
export async function followDecision(
  deps: FollowDeps,
  decision: JobPayload<'creator_tasks.suggestion_decided'>,
): Promise<void> {
  const idea = await deps.ideas.ofSuggestion(decision.suggestionId);
  if (idea?.creatorId !== String(decision.creatorId) || idea.state !== 'suggested') return;
  if (decision.state === 'declined') {
    await deps.ideas.declined(idea.id);
    return;
  }
  // An idea never has the script category (its contract refuses it): a script is asked with a structure of the library.
  if (idea.requestId !== null) return;
  await deps.requestFromIdea({
    id: idea.id,
    creatorId: decision.creatorId,
    category: idea.category,
    dueOn: decision.day,
    reason: idea.title,
  });
  await deps.ideas.requested(idea.id);
}

/**
 * `content_drops.drop_received` (VEI-01 d3): her drop for a content request has all its bytes. The idea of hers that
 * asked the request (the request carries the idea's id) is `deposited`; a request no idea asked moves nothing.
 * Replayable: the idea moves only from `suggested`.
 */
export async function followDeposit(
  deps: Pick<FollowDeps, 'ideas'>,
  received: JobPayload<'content_drops.drop_received'>,
): Promise<void> {
  await deps.ideas.deposited(received.creatorId, received.requestId);
}
