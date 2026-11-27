import { describe, expect, it } from 'vitest';

import { fanSignsOf } from '../signs';

const plain = { intent: 'small_talk', risks: [], fanText: 'ça va et toi ?' };

describe('fanSignsOf (ADR 0135, Charles 27/11)', () => {
  it('reads nothing in an ordinary message', () => {
    expect(fanSignsOf(plain)).toEqual([]);
  });

  it('reads each sign from the brain and his words', () => {
    expect(fanSignsOf({ ...plain, occasion: 'asks_proof' })).toEqual(['proof_again']);
    expect(fanSignsOf({ ...plain, intent: 'price_objection' })).toEqual(['haggles']);
    expect(fanSignsOf({ ...plain, intent: 'asks_for_media' })).toEqual(['free_after_refusal']);
    expect(fanSignsOf({ ...plain, risks: ['insult'] })).toEqual(['pressure']);
    expect(fanSignsOf({ ...plain, intent: 'asks_to_meet' })).toEqual(['contact_insistence']);
  });

  it('reads a purchase put off, in several languages', () => {
    for (const fanText of [
      'je te le prends demain promis',
      'je t’achète ça plus tard',
      'quand je serai payé je débloque tout',
      "I'll buy it tomorrow babe",
      'te lo compro domani',
    ])
      expect(fanSignsOf({ ...plain, fanText }), fanText).toContain('purchase_promise');
    expect(fanSignsOf({ ...plain, fanText: 'je prends un café demain matin' })).not.toContain(
      'purchase_promise',
    );
  });

  it('reads an apology', () => {
    for (const fanText of ['désolé pour hier', 'pardon j’ai été lourd', 'sorry for that', 'scusami'])
      expect(fanSignsOf({ ...plain, fanText }), fanText).toContain('apologised');
  });
});
