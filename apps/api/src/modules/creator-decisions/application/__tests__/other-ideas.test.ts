import {
  CreatorDecisionIdSchema,
  CreatorIdSchema,
  newId,
  type CreatorDecision,
  type DecisionAnswer,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  DecisionIdeasPending,
  DecisionIdeasUnavailable,
  DecisionNoMoreIdeas,
  DecisionNotFound,
} from '../../domain/errors';
import type { OtherIdeasAsk, OtherIdeasWriter } from '../../domain/ports';
import { otherIdeas, type OtherIdeasDeps } from '../other-ideas';

const NOW = new Date('2026-11-21T10:00:00.000Z');
const CREATOR = newId(CreatorIdSchema);
const ID = newId(CreatorDecisionIdSchema);
const row = (key: string, text: string): DecisionAnswer => ({ key, label: key, text, noted: 'C’est noté.' });
const decision: CreatorDecision = {
  id: ID,
  kind: 'caption',
  category: 'socials',
  question: 'Quelle légende ?',
  context: 'Un Reel inventé.',
  layout: 'rows',
  answers: [row('question', 'Une ?'), row('funny', 'Deux')],
  otherIdeasLeft: 2,
};
const other = [row('short', 'Trois'), row('story', 'Quatre')];
const wish = { hints: ['shorter'], note: '' };

function setup(
  writer: OtherIdeasWriter | undefined,
  kept: 'kept' | 'closed' | 'busy' = 'kept',
): { deps: OtherIdeasDeps; written: (readonly DecisionAnswer[])[]; steps: string[] } {
  const written: (readonly DecisionAnswer[])[] = [];
  const steps: string[] = [];
  return {
    written,
    steps,
    deps: {
      store: { renewable: () => Promise.resolve({ creatorId: CREATOR, subject: `drop:${ID}`, decision }) },
      asking: {
        countIdeas: () => {
          steps.push('counted');
          return Promise.resolve(kept !== 'busy');
        },
        returnIdeas: () => {
          steps.push('returned');
          return Promise.resolve();
        },
        otherIdeas: (_creatorId, _id, answers) => {
          written.push(answers);
          return Promise.resolve(
            kept === 'closed' ? null : { ...decision, answers: [...answers], otherIdeasLeft: 1 },
          );
        },
      },
      writers: writer === undefined ? {} : { caption: writer },
    },
  };
}

describe('« D’autres idées » on a decision of hers (ADR 0164 § 9)', () => {
  it('hands her wish and what she reads to the code that proposes for this kind, then keeps its answers', async () => {
    const asks: OtherIdeasAsk[] = [];
    const { deps, written, steps } = setup((ask) => {
      asks.push(ask);
      return Promise.resolve(other);
    });

    const renewed = await otherIdeas(deps, 'user', ID, wish, NOW);

    expect(asks).toEqual([{ creatorId: CREATOR, subject: `drop:${ID}`, shown: decision.answers, wish }]);
    expect(written).toEqual([other]);
    expect(steps).toEqual(['counted']);
    expect(renewed).toMatchObject({ answers: other, otherIdeasLeft: 1 });
  });

  it('offers nothing for a kind nobody proposes for', async () => {
    const { deps, written, steps } = setup(undefined);

    await expect(otherIdeas(deps, 'user', ID, wish, NOW)).rejects.toBeInstanceOf(DecisionNoMoreIdeas);
    expect(written).toEqual([]);
    expect(steps).toEqual([]);
  });

  it('keeps nothing, and gives her request back, when nothing can be proposed for now', async () => {
    const { deps, written, steps } = setup(() => Promise.resolve('unavailable'));

    await expect(otherIdeas(deps, 'user', ID, wish, NOW)).rejects.toBeInstanceOf(DecisionIdeasUnavailable);
    expect(written).toEqual([]);
    expect(steps).toEqual(['counted', 'returned']);
  });

  it('gives her request back when the code that proposes refuses her wish', async () => {
    const { deps, steps } = setup(() => Promise.reject(new Error('a hint nobody knows')));

    await expect(otherIdeas(deps, 'user', ID, wish, NOW)).rejects.toThrow('a hint nobody knows');
    expect(steps).toEqual(['counted', 'returned']);
  });

  it('never asks the code that proposes while another request is being written', async () => {
    let asked = 0;
    const { deps } = setup(() => {
      asked += 1;
      return Promise.resolve(other);
    }, 'busy');

    await expect(otherIdeas(deps, 'user', ID, wish, NOW)).rejects.toBeInstanceOf(DecisionIdeasPending);
    expect(asked).toBe(0);
  });

  it('finds no question when it was answered or withdrawn while the ideas were written', async () => {
    const { deps } = setup(() => Promise.resolve(other), 'closed');

    await expect(otherIdeas(deps, 'user', ID, wish, NOW)).rejects.toBeInstanceOf(DecisionNotFound);
  });
});
