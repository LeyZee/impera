import { HELP_LINES, HelpLinesSchema, type HelpLine } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { CARE_BRIEF, checkCare, checkHelpNumber, helpBubble, helpLanguageOf } from '../care';

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

  it('stops seduction without a sexual word: a wink, a flame, « toute à toi » (recette AGR-08)', () => {
    const codes = (text: string) => checkCare([text]).map((v) => v.match);
    expect(codes('hihi j’avoue 😏')).toEqual(['hihi', '😏']);
    expect(codes('Courage toi 🔥')).toEqual(['🔥']);
    expect(codes('je suis toute à toi ce soir')).toEqual(['toute a toi']);
    expect(codes('Je suis là pour toi, vraiment 🤍')).toEqual([]);
  });

  it('asks the voice for no sale, no seduction, no promise and no medical advice', () => {
    for (const words of ['sans séduction', 'sans promesse', 'sans conseil médical', 'sans rien proposer']) {
      expect(CARE_BRIEF).toContain(words);
    }
  });
});

describe('the help bubble (ADR 0088 § 4)', () => {
  it('never picks a number by his language, French included (ADR 0168 § 8)', () => {
    expect(helpLanguageOf('je veux plus vivre, j’en peux plus')).toBe('french');
    expect(helpLanguageOf('I want to die, I can’t take it anymore')).toBe('english');
    expect(helpLanguageOf('')).toBe('french');
    for (const language of ['french', 'english', 'italian', 'spanish'] as const)
      expect(helpBubble(language)).not.toMatch(/\d/u);
  });

  it('has one bubble per covered language, chosen by his words, else his kept language (ADR 0168 § 5)', () => {
    expect(helpLanguageOf('non ce la faccio più, voglio morire, sono stanco di tutto')).toBe('italian');
    expect(helpLanguageOf('ya no puedo más, quiero morir, estoy cansado de todo')).toBe('spanish');
    expect(helpLanguageOf('basta', 'italian')).toBe('italian');
    expect(helpLanguageOf('مرحبا كيف حالك اليوم')).toBe('english');
    expect(helpBubble('italian')).not.toBe(helpBubble('spanish'));
  });

  it('names his country’s line only when his country is confirmed and the table has a verified row for it', () => {
    // An invented country and number, for the test only: the shipped table is empty (ADR 0168 § 8).
    const lines: HelpLine[] = [
      {
        country: 'ZZ',
        number: '0000',
        label: 'ligne d’écoute inventée',
        sourceUrl: 'https://example.test/ligne',
        verifiedAt: '2026-11-26',
      },
    ];
    expect(helpBubble('italian', 'ZZ', lines)).toContain('0000 (ligne d’écoute inventée)');
    expect(helpBubble('french', 'ZZ', lines)).toContain('appelle le 0000 (ligne d’écoute inventée)');
    // Unknown country, or no verified row: the bubble without a national number.
    expect(helpBubble('italian', null, lines)).toBe(helpBubble('italian'));
    expect(helpBubble('italian', 'YY', lines)).toBe(helpBubble('italian'));
    expect(helpBubble('english', 'ZZ')).toBe(helpBubble('english'));
    expect(HELP_LINES).toEqual([]);
    expect(checkCare([helpBubble('spanish', 'ZZ', lines)])).toEqual([]);
  });

  it('refuses a table row without its official source, its date, or with a country twice', () => {
    const row = {
      country: 'ZZ',
      number: '0000',
      label: 'ligne inventée',
      sourceUrl: 'https://example.test/ligne',
      verifiedAt: '2026-11-26',
    };
    expect(HelpLinesSchema.safeParse([row]).success).toBe(true);
    expect(HelpLinesSchema.safeParse([{ ...row, sourceUrl: 'http://example.test' }]).success).toBe(false);
    expect(HelpLinesSchema.safeParse([{ ...row, verifiedAt: 'hier' }]).success).toBe(false);
    expect(HelpLinesSchema.safeParse([{ ...row, country: 'zz' }]).success).toBe(false);
    expect(HelpLinesSchema.safeParse([row, row]).success).toBe(false);
  });

  it('is one bubble in her casual voice: lowercase, no emoji, the number posed by code', () => {
    const line: HelpLine = {
      country: 'ZZ',
      number: '0000',
      label: 'ligne inventée',
      sourceUrl: 'https://example.test/ligne',
      verifiedAt: '2026-11-26',
    };
    for (const language of ['french', 'english', 'italian', 'spanish'] as const) {
      for (const bubble of [helpBubble(language), helpBubble(language, 'ZZ', [line])]) {
        expect(bubble.charAt(0)).toBe(bubble.charAt(0).toLowerCase());
        expect(bubble).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(bubble).not.toContain('\n');
      }
    }
    expect(helpBubble('french')).toContain('numéro d’urgence de ton pays');
  });

  it('passes its own guard: the code writes nothing the care mode would refuse', () => {
    expect(
      checkCare([helpBubble('french'), helpBubble('english'), helpBubble('italian'), helpBubble('spanish')]),
    ).toEqual([]);
  });
});

describe('a help number the model writes itself (ADR 0088 § 4, eval pass 2)', () => {
  const blocked = (text: string) => checkHelpNumber([text]).some((v) => v.code === 'help_number_from_model');

  it.each([
    'appelle le 988',
    'call 988',
    'chiama il 112',
    'llama al 024',
    'tu peux appeler le 3114 tu sais',
    'compose le 15 si ça va pas',
    '116 123, ils écoutent',
    'call 1-800-000-0000',
    'appelle SOS Amitié',
    'the samaritans can help',
    'chiama il telefono amico',
    'llama al teléfono de la esperanza',
  ])('refuses « %s »', (text) => {
    expect(blocked(text)).toBe(true);
  });

  it.each([
    'on se voit le 15',
    'j’ai 18 ans de plus que toi',
    'appelle-moi à 18h',
    'ça coûte 15 €',
    'je suis là',
  ])('lets « %s » through', (text) => {
    expect(blocked(text)).toBe(false);
  });

  it('lets the code’s help bubble through in every language, and says so in the care brief', () => {
    for (const language of ['french', 'english', 'italian', 'spanish'] as const)
      expect(checkHelpNumber([helpBubble(language)])).toEqual([]);
    expect(CARE_BRIEF).toContain('jamais elle-même de numéro');
  });

  it('lets the code’s national bubble with a test row through; the composer reads only the model’s bubbles anyway', () => {
    // An invented row, for the test only (ADR 0010). The composer runs this guard on the voice's bubbles, then appends
    // the help bubble (draft-composer test « never lets the voice give a help number itself »).
    const line: HelpLine = {
      country: 'ZZ',
      number: '0000',
      label: 'ligne inventée',
      sourceUrl: 'https://example.test/ligne',
      verifiedAt: '2026-11-26',
    };
    expect(helpBubble('french', 'ZZ', [line])).toContain('appelle le 0000');
    expect(checkHelpNumber([helpBubble('french', 'ZZ', [line])])).toEqual([]);
  });
});
