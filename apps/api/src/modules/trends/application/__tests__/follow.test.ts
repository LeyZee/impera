import {
  ContentDropIdSchema,
  ContentRequestIdSchema,
  CreatorIdSchema,
  newId,
  SuggestionIdSchema,
  type DropCategory,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { IdeaContentRequest } from '../../../content-drops';
import type { IdeaFollowStore } from '../../domain/ports';
import { followDecision, followDeposit } from '../follow';

const creatorId = newId(CreatorIdSchema);
const suggestionId = newId(SuggestionIdSchema);

function fakes(category: DropCategory) {
  const asked: IdeaContentRequest[] = [];
  const moves: string[] = [];
  const ideas: IdeaFollowStore = {
    ofSuggestion: () =>
      Promise.resolve({
        id: 'idea-1',
        creatorId,
        state: 'suggested',
        category,
        title: 'Robe verte',
        requestId: null,
      }),
    requested: (id) => {
      moves.push(`requested:${id}`);
      return Promise.resolve();
    },
    declined: (id) => {
      moves.push(`declined:${id}`);
      return Promise.resolve();
    },
    deposited: (creator, requestId) => {
      moves.push(`deposited:${creator}:${requestId}`);
      return Promise.resolve();
    },
  };
  const requestFromIdea = (request: IdeaContentRequest) => {
    asked.push(request);
    return Promise.resolve();
  };
  return { deps: { ideas, requestFromIdea }, asked, moves };
}

describe('followDecision (VEI-01 d2)', () => {
  it('asks the content of an accepted shoot for its day, under the idea’s id', async () => {
    const { deps, asked, moves } = fakes('feed_shoot');
    await followDecision(deps, { creatorId, suggestionId, state: 'accepted', day: '2026-11-12' });
    expect(asked).toEqual([
      { id: 'idea-1', creatorId, category: 'feed_shoot', dueOn: '2026-11-12', reason: 'Robe verte' },
    ]);
    expect(moves).toEqual(['requested:idea-1']);
  });

  it('never asks a script: a script is asked with a structure of the library', async () => {
    const { deps, asked, moves } = fakes('script');
    await followDecision(deps, { creatorId, suggestionId, state: 'accepted', day: '2026-11-12' });
    expect([asked, moves]).toEqual([[], []]);
  });

  it('declines the idea of a declined shoot, and asks nothing for another creator', async () => {
    const declined = fakes('feed_shoot');
    await followDecision(declined.deps, { creatorId, suggestionId, state: 'declined', day: '2026-11-12' });
    expect(declined.moves).toEqual(['declined:idea-1']);
    const other = fakes('feed_shoot');
    await followDecision(other.deps, {
      creatorId: newId(CreatorIdSchema),
      suggestionId,
      state: 'accepted',
      day: '2026-11-12',
    });
    expect([other.asked, other.moves]).toEqual([[], []]);
  });
});

describe('followDeposit (VEI-01 d3)', () => {
  it('moves the idea that asked the request, by the request and the creator', async () => {
    const { deps, moves } = fakes('feed_shoot');
    const requestId = newId(ContentRequestIdSchema);
    await followDeposit(deps, { creatorId, dropId: newId(ContentDropIdSchema), requestId });
    expect(moves).toEqual([`deposited:${creatorId}:${requestId}`]);
  });
});
