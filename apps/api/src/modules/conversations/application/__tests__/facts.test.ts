import { MessageIdSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { operatorNoteFact, readProposedFacts } from '../facts';

const now = new Date('2026-10-20T18:05:00Z');
const source = {
  id: MessageIdSchema.parse('00000000-0000-4000-8000-000000000001'),
  at: new Date('2026-10-20T18:00:00Z'),
};

describe('readProposedFacts', () => {
  it('dates each fact by the fan’s message it was read in', () => {
    expect(
      readProposedFacts(
        [{ category: 'identity', key: 'location', value: 'Nantes', kind: 'declared', confidence: 0.9 }],
        source,
        now,
      ),
    ).toEqual([
      {
        category: 'identity',
        key: 'location',
        value: 'Nantes',
        kind: 'declared',
        confidence: 0.9,
        sourceMessageId: source.id,
        observedAt: source.at,
      },
    ]);
  });

  it('drops a category the contract does not know, and an operator note from a model', () => {
    expect(
      readProposedFacts(
        [
          { category: 'mood', key: 'today', value: 'joyeux', kind: 'inferred', confidence: 0.5 },
          { category: 'operator_note', key: 'note', value: 'à suivre', kind: 'declared', confidence: 1 },
        ],
        source,
        now,
      ),
    ).toEqual([]);
  });

  it('dates by now when no message of the fan is known', () => {
    const [fact] = readProposedFacts(
      [{ category: 'life', key: 'situation', value: 'célibataire', kind: 'inferred', confidence: 0.6 }],
      null,
      now,
    );
    expect(fact).toMatchObject({ sourceMessageId: null, observedAt: now });
  });
});

describe('operatorNoteFact', () => {
  it('gives each note its own slot, the same one on a replay', () => {
    const at = new Date('2026-10-20T19:00:00Z');
    expect(operatorNoteFact('Aime le foot', at)).toEqual(operatorNoteFact('Aime le foot', at));
    expect(operatorNoteFact('Aime le foot', at).key).not.toBe(
      operatorNoteFact('Aime le foot', new Date('2026-10-21T19:00:00Z')).key,
    );
    expect(operatorNoteFact('Aime le foot', at)).toMatchObject({
      category: 'operator_note',
      kind: 'declared',
      confidence: 1,
    });
  });
});
