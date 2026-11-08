import { MessageIdSchema, type FanCardRead } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { cardOf } from '../card';
import { cardLinesOf, proposalsOfRead, type ReadSource } from '../card-read';
import type { StoredFact } from '../facts';

const said = new Date('2026-11-02T18:00:00Z');
const now = new Date('2026-11-02T18:10:00Z');
const message = MessageIdSchema.parse('00000000-0000-4000-8000-0000000000a2');
const sources: readonly ReadSource[] = [{ number: 2, messageId: message, at: said }];

const fact = (over: Partial<FanCardRead['facts'][number]>): FanCardRead['facts'][number] => ({
  field: 'age',
  items: ['34'],
  kind: 'declared',
  confidence: 0.9,
  message: 2,
  ...over,
});

const stored = (over: Partial<StoredFact>): StoredFact => ({
  id: 'f-1',
  category: 'interests',
  key: 'hobbies',
  value: 'foot · séries',
  kind: 'declared',
  confidence: 0.9,
  sourceMessageId: null,
  observedAt: new Date('2026-10-01T10:00:00Z'),
  expiresAt: null,
  supersededBy: null,
  notedBy: null,
  ...over,
});

const empty = cardOf([], [], now);
const proposals = (facts: FanCardRead['facts'], card = empty) => proposalsOfRead({ facts }, sources, card);

describe('the AI’s read of his card (ADR 0085 § 7)', () => {
  it('gives the read one line per field the card shows, with where it comes from', () => {
    const card = cardOf(
      [
        stored({}),
        stored({ id: 'f-2', category: 'commercial', key: 'payday', value: 'le 5', kind: 'inferred' }),
      ],
      [],
      now,
    );
    expect(cardLinesOf(card)).toEqual(['hobbies : foot · séries (dit par lui)', 'payday : le 5 (deviné)']);
  });

  it('writes a value in its field’s category, resting on his message', () => {
    expect(proposals([fact({})])).toEqual([
      {
        category: 'identity',
        key: 'age',
        value: '34',
        kind: 'declared',
        confidence: 0.9,
        sourceMessageId: message,
        observedAt: said,
      },
    ]);
  });

  it('drops a value resting on no new message of his', () => {
    expect(proposals([fact({ message: 1 })])).toEqual([]);
  });

  it('writes an observed field as guessed, whatever the read says', () => {
    const [payday, lead] = proposals([
      fact({ field: 'payday', items: ['début du mois'] }),
      fact({ field: 'lead', items: ['she_leads'] }),
    ]);
    expect(payday?.kind).toBe('inferred');
    expect(lead).toMatchObject({ kind: 'inferred', value: 'she_leads' });
  });

  it('drops what the card never keeps, a value outside a closed list, a list for one value', () => {
    expect(
      proposals([
        fact({ field: 'hobbies', items: ['snap basile42'] }),
        fact({ field: 'intensity', items: ['tendre'] }),
        fact({ field: 'first_name', items: ['Basile', 'Bas'] }),
      ]),
    ).toEqual([]);
  });

  it('adds the new items of a list to those the card shows, once each', () => {
    const card = cardOf([stored({})], [], now);
    const [hobbies] = proposals([fact({ field: 'hobbies', items: ['Séries', 'guitare'] })], card);
    expect(hobbies?.value).toBe('foot · séries · guitare');
    const twice = proposals(
      [fact({ field: 'hobbies', items: ['guitare'] }), fact({ field: 'hobbies', items: ['vélo'] })],
      card,
    );
    expect(twice.at(-1)?.value).toBe('foot · séries · guitare · vélo');
  });

  it('drops the oldest items of a list once the line is full', () => {
    const long = 'x'.repeat(150);
    const card = cardOf([stored({ value: `${long}a · ${long}b` })], [], now);
    const [hobbies] = proposals([fact({ field: 'hobbies', items: ['guitare'] })], card);
    expect(hobbies?.value).toBe(`${long}b · guitare`);
  });

  it('lets a happening of his life expire 30 days after he told it', () => {
    const [event] = proposals([fact({ field: 'life_events', items: ['opéré jeudi'] })]);
    expect(event?.expiresAt).toEqual(new Date('2026-12-02T18:00:00Z'));
  });
});
