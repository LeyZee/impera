import { describe, expect, it } from 'vitest';

import { pickObjectionReply } from '../objections';

const bank = {
  too_expensive: [
    { id: 'testaaaaaaaa', text: 'Réplique de test A' },
    { id: 'testbbbbbbbb', text: 'Réplique de test B' },
  ],
  asks_discount: [{ id: 'testcccccccc', text: 'Réplique de test C' }],
};

describe('pickObjectionReply (ADR 0090 § B)', () => {
  it('picks the first reply of his kind, in the order the agency wrote them', () => {
    expect(pickObjectionReply(bank, 'too_expensive', new Set())).toEqual({
      objection: 'too_expensive',
      replyId: 'testaaaaaaaa',
      text: 'Réplique de test A',
    });
  });

  it('never gives him a reply he already received', () => {
    expect(pickObjectionReply(bank, 'too_expensive', new Set(['testaaaaaaaa']))?.replyId).toBe(
      'testbbbbbbbb',
    );
    expect(
      pickObjectionReply(bank, 'too_expensive', new Set(['testaaaaaaaa', 'testbbbbbbbb'])),
    ).toBeUndefined();
  });

  it('gives nothing without a bank for his objection', () => {
    expect(pickObjectionReply(bank, 'free_elsewhere', new Set())).toBeUndefined();
    expect(pickObjectionReply(bank, 'other', new Set())).toBeUndefined();
    expect(pickObjectionReply(bank, undefined, new Set())).toBeUndefined();
    expect(pickObjectionReply({}, 'asks_discount', new Set())).toBeUndefined();
  });
});
