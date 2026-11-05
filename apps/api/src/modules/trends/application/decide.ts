import {
  DROP_CATEGORY_LABELS,
  type AgencySuggestion,
  type ContentIdea,
  type ContentIdeaCorrection,
  type CreatorId,
  type PersonaLimits,
  type UserId,
  type ValidatedContentIdea,
} from '@impera/contracts';

import { touchesTerm } from '../../agent';
import type { ShootSuggestion } from '../../creator-tasks';
import { ContentIdeaGuarded } from '../domain/errors';
import { guardFaultOf } from '../domain/ideas';
import type { IdeaStore } from '../domain/ports';

export interface DecideDeps {
  readonly ideas: IdeaStore;
  /** Her active persona's limits, null without one (ADR 0056 § 1). */
  readonly limitsOf: (creatorId: CreatorId) => Promise<PersonaLimits | null>;
  /** The agenda's own door (`creator-tasks` index): the trend watch writes no table of hers. */
  readonly suggestShoot: (
    creatorId: string,
    userId: string,
    shoot: ShootSuggestion,
    now: Date,
  ) => Promise<AgencySuggestion>;
}

/** What she reads in her agenda of a validated idea: its title, what it is for, and what to shoot as her sheet. */
function shootOf(idea: ContentIdea): ShootSuggestion {
  return {
    // The idea's id: a validation replayed meets the suggestion it already made.
    id: idea.id,
    title: idea.title,
    purpose: `Pour : ${DROP_CATEGORY_LABELS[idea.category]}`,
    shootBrief: idea.toShoot,
    minutes: idea.shootMinutes,
  };
}

/**
 * « Valider » in « Idées du jour » (ADR 0060 § 5): the idea, corrected or not, read again by the code's guards, then a
 * suggestion in her agenda, in her first open dispo or undated. Never its reason nor its signal, which are the agency's
 * (she never sees the trend watch, ADR 0042). Two writes, each replayable: an idea left `validated` by a failure is
 * suggested by the same gesture again.
 */
export async function validateIdea(
  deps: DecideDeps,
  creatorId: CreatorId,
  userId: UserId,
  ideaId: string,
  correction: ContentIdeaCorrection | null,
  now: Date,
): Promise<ValidatedContentIdea> {
  const limits = await deps.limitsOf(creatorId);
  const validated = await deps.ideas.validate(
    creatorId,
    userId,
    ideaId,
    correction,
    (idea) => {
      const fault = guardFaultOf(idea, limits, touchesTerm);
      if (fault !== null) throw new ContentIdeaGuarded(fault.reason);
    },
    now,
  );
  const suggestion = await deps.suggestShoot(creatorId, userId, shootOf(validated), now);
  const idea = await deps.ideas.suggested(creatorId, userId, ideaId);
  return { idea, suggestion };
}
