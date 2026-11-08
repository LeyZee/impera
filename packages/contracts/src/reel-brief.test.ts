import { describe, expect, it } from 'vitest';

import {
  CreateSuggestionBodySchema,
  countWords,
  keepWords,
  REEL_HOOK_WORDS_MAX,
  ReelBriefSchema,
} from './creator-tasks';
import { reelBriefFits, ValidateContentIdeaBodySchema } from './trends';

// Invented sentences only (ADR 0010).
const sheet = {
  hook: 'Tu ne devineras jamais ce que je cache',
  onScreen: 'Mon tiroir secret',
  shots: ['Gros plan sur le tiroir fermé', 'Elle ouvre, regard caméra'],
  ending: 'Elle referme le tiroir comme au début',
  seconds: 20,
};

describe('the words of a reel sheet (ADR 0082 § 3)', () => {
  it('counts letters and digits in a row, never cut by an inner apostrophe or hyphen', () => {
    expect(countWords("j'ai")).toBe(1);
    expect(countWords('j’ai peut-être 2 chats')).toBe(4);
    expect(countWords('  Bonjour,   toi !  ')).toBe(2);
    expect(countWords('Ça a marché')).toBe(3);
  });

  it('counts an emoji and punctuation for nothing', () => {
    expect(countWords('🔥🔥 … !')).toBe(0);
    expect(countWords('regarde 👀 bien')).toBe(2);
  });

  it('keeps a text to its first words, as it is when within its bound', () => {
    expect(keepWords('un deux trois quatre', 2)).toBe('un deux');
    expect(keepWords('un deux ', 2)).toBe('un deux ');
    expect(keepWords('un, deux… trois', 2)).toBe('un, deux');
    expect(keepWords('🔥 un', 1)).toBe('🔥 un');
  });
});

describe('ReelBriefSchema', () => {
  it('takes a sheet within its bounds, its optional fields null', () => {
    expect(ReelBriefSchema.safeParse(sheet).success).toBe(true);
    expect(ReelBriefSchema.safeParse({ ...sheet, onScreen: null, ending: null }).success).toBe(true);
  });

  it('refuses a word more than the first sentence or the text on screen takes', () => {
    const nine = 'un deux trois quatre cinq six sept huit neuf';
    expect(countWords(nine)).toBe(REEL_HOOK_WORDS_MAX + 1);
    expect(ReelBriefSchema.safeParse({ ...sheet, hook: nine }).success).toBe(false);
    expect(
      ReelBriefSchema.safeParse({ ...sheet, onScreen: 'un deux trois quatre cinq six sept' }).success,
    ).toBe(false);
    expect(ReelBriefSchema.safeParse({ ...sheet, hook: '🔥🔥' }).success).toBe(false);
  });

  it('takes from two to six shots of a line, and from 5 to 90 seconds', () => {
    expect(ReelBriefSchema.safeParse({ ...sheet, shots: ['Un seul plan'] }).success).toBe(false);
    expect(ReelBriefSchema.safeParse({ ...sheet, shots: Array(7).fill('Un plan') }).success).toBe(false);
    expect(ReelBriefSchema.safeParse({ ...sheet, shots: ['x'.repeat(81), 'Un plan'] }).success).toBe(false);
    expect(ReelBriefSchema.safeParse({ ...sheet, seconds: 4 }).success).toBe(false);
    expect(ReelBriefSchema.safeParse({ ...sheet, seconds: 91 }).success).toBe(false);
    expect(ReelBriefSchema.safeParse({ ...sheet, extra: true }).success).toBe(false);
  });
});

describe('a reel sheet goes only with a Reel Insta', () => {
  const body = {
    id: '01960000-0000-7000-8000-000000000001',
    when: { kind: 'day', day: '2026-11-10' },
    category: 'shoot',
    title: 'Tourner le tiroir',
  };

  it('is taken on a shoot suggested for a Reel Insta, and refused on another category (400)', () => {
    expect(
      CreateSuggestionBodySchema.safeParse({ ...body, dropCategory: 'instagram_reel', reelBrief: sheet })
        .success,
    ).toBe(true);
    expect(
      CreateSuggestionBodySchema.safeParse({ ...body, dropCategory: 'instagram_post', reelBrief: sheet })
        .success,
    ).toBe(false);
    expect(CreateSuggestionBodySchema.safeParse({ ...body, reelBrief: sheet }).success).toBe(false);
    expect(
      CreateSuggestionBodySchema.safeParse({ ...body, category: 'live', dropCategory: 'instagram_reel' })
        .success,
    ).toBe(false);
  });

  it('is taken by a correction of a Reel Insta idea, refused when the correction moves it elsewhere', () => {
    expect(reelBriefFits({ category: 'instagram_reel', reelBrief: ReelBriefSchema.parse(sheet) })).toBe(true);
    expect(reelBriefFits({ category: 'feed_shoot', reelBrief: null })).toBe(true);
    expect(
      ValidateContentIdeaBodySchema.safeParse({
        correction: { category: 'instagram_post', reelBrief: sheet },
      }).success,
    ).toBe(false);
    expect(
      ValidateContentIdeaBodySchema.safeParse({
        correction: { category: 'instagram_reel', reelBrief: sheet },
      }).success,
    ).toBe(true);
  });
});
