import { describe, expect, it } from 'vitest';

import { CARE_BRIEF, checkCare, helpBubble, helpLanguageOf } from '../care';

describe('checkCare (ADR 0088 § 3)', () => {
  it('lets a gentle answer through, a hug and a kiss included', () => {
    expect(
      checkCare([
        'Oh mon cœur, je suis là, je t’écoute 🤍',
        'Je t’embrasse fort, un gros câlin. Tu peux en parler à quelqu’un de proche ?',
        'Je pense fort à toi ce soir',
      ]),
    ).toEqual([]);
  });

  it('stops a price, a link, a media, a meeting or a sexual word, and says which', () => {
    const codes = (text: string) => checkCare([text]).map((v) => v.match);
    expect(codes('Ça te fera du bien, c’est 15 € seulement')).not.toEqual([]);
    expect(codes('Va voir www.exemple.com')).not.toEqual([]);
    expect(codes('Je t’envoie une photo pour te changer les idées')).toEqual(['photo']);
    expect(codes('On pourrait se voir demain si tu veux')).toEqual(['se voir']);
    expect(codes('Tu me rends toute chose, j’ai envie de toi')).toEqual(['envie de toi']);
    expect(codes('Je débloque un petit contenu rien que pour toi')).toEqual(['debloque', 'contenu']);
    for (const violation of checkCare(['15 € ?', 'sexy'])) {
      expect(violation).toMatchObject({ code: 'care_breach', severity: 'blocking' });
    }
  });

  it('asks the voice for no sale, no seduction, no promise and no medical advice', () => {
    for (const words of ['sans séduction', 'sans promesse', 'sans conseil médical', 'sans rien proposer']) {
      expect(CARE_BRIEF).toContain(words);
    }
  });
});

describe('the help bubble (ADR 0088 § 4)', () => {
  it('gives the 3114 to a fan who writes in French, and no number to another', () => {
    expect(helpLanguageOf('je veux plus vivre, j’en peux plus')).toBe('fr');
    expect(helpLanguageOf('I want to die, I can’t take it anymore')).toBe('other');
    expect(helpLanguageOf('')).toBe('fr');
    expect(helpBubble('fr')).toContain('3114');
    expect(helpBubble('other')).not.toMatch(/\d/u);
  });

  it('passes its own guard: the code writes nothing the care mode would refuse', () => {
    expect(checkCare([helpBubble('fr'), helpBubble('other')])).toEqual([]);
  });
});
