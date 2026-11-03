import type { ContentIdeaDraft } from '@nirvana/contracts';

import { touchesTerm } from '../../agent';
import { filterIdeas, type FilteredIdeas, type IdeaFilterContext } from '../domain/ideas';

/**
 * The day's ideas through the code's filters (ADR 0060 § 4), her limits read as the agent's guards read them: the
 * one reading of a persona's entry (`touchesTerm`, ADR 0056 § 1), taken from the agent's index and never copied.
 */
export function filterDayIdeas(
  candidates: readonly ContentIdeaDraft[],
  context: Omit<IdeaFilterContext, 'touches'>,
): FilteredIdeas {
  return filterIdeas(candidates, { ...context, touches: touchesTerm });
}
