import { describe, expect, it } from 'vitest';

import { DEFAULT_GUARD_SETTINGS } from '../../domain/guards';
import { createBubbleGuard } from '../bubble-guard';

describe('bubble guard (approval of edited bubbles)', () => {
  const guard = createBubbleGuard({ ...DEFAULT_GUARD_SETTINGS, forbiddenTerms: ['Mon adresse'] });

  it('refuses an edit that gives her away, split or masked, and her forbidden words', () => {
    expect(guard.check(['ok je suis une', '1A'])).toEqual({ isBlocked: true, codes: ['ai_disclosure'] });
    expect(guard.check(['mon num 06 12', '34 56 78'])).toMatchObject({
      isBlocked: true,
      codes: ['contact_info'],
    });
    expect(guard.check(['Je te donne mon adresse ?']).codes).toContain('forbidden_term');
  });

  it('lets a long or many-bubble edit through: soft guards are the chatter’s call', () => {
    const long = 'Coucou '.repeat(60);
    expect(guard.check([long, 'a', 'b', 'c', 'd'])).toEqual({ isBlocked: false, codes: [] });
  });

  it('lets a line she already sent him through: sending it again is the chatter’s call', () => {
    const line = 'Tu fais quoi de beau ce soir ?';
    expect(guard.check([line], { previousTurns: [[line]], sentBefore: [line] })).toEqual({
      isBlocked: false,
      codes: [],
    });
  });

  it('lets a chatter write a word kept for close fans, and misplaced emojis: the chatter sees the fan (26/11)', () => {
    const close = createBubbleGuard({
      ...DEFAULT_GUARD_SETTINGS,
      closeOnlyWords: [{ words: ['mon cœur'], minTier: 4 }],
    });
    expect(close.check(['😘 bonne nuit mon cœur'], { previousTurns: [] })).toEqual({
      isBlocked: false,
      codes: [],
    });
  });

  it('reads the care guard on a chatter’s words while a care episode is open (ADR 0088 § 3, § 5)', () => {
    const explicit = ['Viens on se change les idées, je suis toute mouillée'];
    expect(guard.check(explicit)).toEqual({ isBlocked: false, codes: [] });
    expect(guard.check(explicit, {}, true)).toEqual({ isBlocked: true, codes: ['care_breach'] });
    expect(guard.check(['Je suis là, parle-moi'], {}, true)).toEqual({ isBlocked: false, codes: [] });
  });
});
