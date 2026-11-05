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
 * the idea is `declined`. A suggestion that no idea became, an idea of another creator, or a script idea (a script is
 * asked with a structure of the library) asks nothing.
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
  // A script is asked with a structure of the library, chosen by the team: an idea never asks one by itself.
  if (idea.requestId !== null || idea.category === 'script') return;
  await deps.requestFromIdea({
    id: idea.id,
    creatorId: decision.creatorId,
    category: idea.category,
    dueOn: decision.day,
    reason: idea.title,
  });
  await deps.ideas.requested(idea.id);
}
