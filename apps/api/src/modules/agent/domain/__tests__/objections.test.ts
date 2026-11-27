import { describe, expect, it } from 'vitest';

import { discountAsked, pickObjectionReply } from '../objections';

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

describe('discountAsked (passe 2 du 26/11, conversation 23)', () => {
  it.each([
    ['Fais-moi un prix stp'],
    ['fais moi une petite réduc'],
    ['L’autre fois c’était moins cher'],
    ['Allez 10 et je prends'],
    ['20 € et c’est bon ?'],
    ['tu peux pas baisser un peu ?'],
    ['c’est négociable ?'],
  ])('reads his discount asked: %s', (text) => {
    expect(discountAsked('small_talk', text)).toBe(true);
    expect(discountAsked('payment_help', text)).toBe(true);
  });

  it.each([
    ['C’est trop cher pour moi'],
    ['Tu fais quoi ce soir ?'],
    ['J’ai pris 10 minutes de pause'],
    ['Je prends ma douche et je reviens'],
  ])('reads none in other words: %s', (text) => {
    expect(discountAsked('small_talk', text)).toBe(false);
  });

  it('leaves what leads before it: a price objection already read, a distress, his custom order', () => {
    for (const intent of ['price_objection', 'distress', 'asks_for_service', 'complaint']) {
      expect(discountAsked(intent, 'Fais-moi un prix')).toBe(false);
    }
  });
});
