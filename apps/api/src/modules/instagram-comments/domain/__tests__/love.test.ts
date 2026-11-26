import { describe, expect, it } from 'vitest';

import { declaresLove, emojisOnly } from '../love';

describe('a declaration of love in a comment', () => {
  it('is read in her languages, apostrophes and accents folded', () => {
    for (const comment of [
      'Je t’aime',
      'je t aime trop',
      'Je t’ai toujours aimée ❤️',
      'jtm',
      'Je suis amoureux de toi',
      'I love you',
      'I’ve always loved you',
      'Ti amo',
      'Te quiero',
    ])
      expect(declaresLove(comment), comment).toBe(true);
  });

  it('is not a compliment nor what he loves in the post', () => {
    for (const comment of [
      'J’aime trop cette photo',
      'J’adore ta robe',
      'Je t’adore',
      'Je t’aime bien, ta photo est top',
      'I love this',
      'Magnifique',
      'On aime ❤️',
    ])
      expect(declaresLove(comment), comment).toBe(false);
  });
});

describe('a reply of emojis only', () => {
  it('has no letter and no digit', () => {
    expect(emojisOnly('🫶🏻🫶🏻')).toBe(true);
    expect(emojisOnly(' ☺️ ')).toBe(true);
    expect(emojisOnly('Merci ☺️')).toBe(false);
    expect(emojisOnly('❤️ 2')).toBe(false);
  });
});
