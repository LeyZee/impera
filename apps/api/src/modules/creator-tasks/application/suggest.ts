import { DROP_CATEGORY_LABELS, type AgencySuggestion, type CreateSuggestionBody } from '@impera/contracts';

import { SuggestionGuarded } from '../domain/errors';
import type { AgencySuggestionStore, ShootGuard } from '../domain/ports';

export interface SuggestDeps {
  readonly store: Pick<AgencySuggestionStore, 'create'>;
  readonly guard: ShootGuard;
}

/**
 * « Proposer une tâche » (CR-05), and a shoot for a drop category with its reel sheet (ADR 0082 § 3). With a drop
 * category, what it is for says it when the agency wrote nothing, as an idea's does, and the suggestion is read by
 * the guards of an idea (her limits, « jamais de nu », the Instagram guard) before it enters her agenda. Without one,
 * nothing changes from before.
 */
export function suggestTask(
  deps: SuggestDeps,
  creatorId: string,
  userId: string,
  body: CreateSuggestionBody,
  now: Date,
): Promise<AgencySuggestion> {
  const { dropCategory } = body;
  if (dropCategory === null) return deps.store.create(creatorId, userId, body, now, () => Promise.resolve());
  const purpose = body.purpose ?? `Pour : ${DROP_CATEGORY_LABELS[dropCategory]}`;
  return deps.store.create(creatorId, userId, { ...body, purpose }, now, async () => {
    const fault = await deps.guard(creatorId, {
      title: body.title,
      purpose,
      dropCategory,
      reelBrief: body.reelBrief,
    });
    if (fault !== null) throw new SuggestionGuarded(fault);
  });
}
