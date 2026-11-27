import { describe, expect, it } from 'vitest';

import { checkEmojis, checkEmojiUse, DEFAULT_EMOJI_STREAK_MAX, emojisIn } from '../emojis';
import { checkVoiceOutput, DEFAULT_GUARD_SETTINGS, isBlocked, wantsRewrite } from '../guards';

// Invented messages (CLAUDE.md: no real fan or creator data).
const calm = { flirting: false, streakMax: DEFAULT_EMOJI_STREAK_MAX };
const flirt = { flirting: true, streakMax: DEFAULT_EMOJI_STREAK_MAX };
const misuses = (bubbles: string[], rules: Parameters<typeof checkEmojis>[1] = calm) =>
  checkEmojis(bubbles, rules).filter((v) => v.code === 'emoji_misuse');

describe('emojisIn', () => {
  it('counts a joined sequence, a skin tone, a flag and a variation selector as one emoji', () => {
    expect(emojisIn('coucou 👩‍💻')).toEqual(['👩‍💻']);
    expect(emojisIn('top 👍🏽')).toEqual(['👍🏽']);
    expect(emojisIn('allez 🇫🇷')).toEqual(['🇫🇷']);
    expect(emojisIn('❤️')).toEqual(emojisIn('❤'));
    expect(emojisIn('aucun ici')).toEqual([]);
  });
});

describe('her emojis (checkEmojis)', () => {
  it('lets one emoji at the end of a bubble through, and an answer without any', () => {
    expect(misuses(['t’es bête 😏'])).toEqual([]);
    expect(misuses(['t’es bête', 'raconte 😏  '])).toEqual([]);
    expect(misuses(['rien à signaler'])).toEqual([]);
  });

  it('refuses an emoji anywhere but at the end of a bubble', () => {
    expect(misuses(['😏 t’es bête'])).toHaveLength(1);
    expect(misuses(['t’es 😏 bête'])[0]).toMatchObject({ bubbleIndex: 0, match: '😏' });
    expect(misuses(['ok', 'trop drôle 🙈 vraiment'])[0]).toMatchObject({ bubbleIndex: 1 });
  });

  it('lets the same emoji doubled through, as one kind', () => {
    expect(misuses(['t’es trop drôle 🙈🙈'])).toEqual([]);
    expect(misuses(['bien joué 👍🏽👍🏽'])).toEqual([]);
  });

  it('reads a joined sequence or a skin tone as one emoji, never as several', () => {
    expect(misuses(['je bosse encore 👩‍💻'])).toEqual([]);
    expect(misuses(['bien vu 👍🏿'])).toEqual([]);
    expect(misuses(['on s’y met 👩‍💻👩‍💻'])).toEqual([]);
  });

  it('allows one kind per answer outside a flirt, two once they flirt', () => {
    expect(misuses(['t’es mignon 😏', 'raconte 🙈'])).toHaveLength(1);
    expect(misuses(['t’es mignon 😏', 'raconte 🙈'], flirt)).toEqual([]);
    expect(misuses(['t’es mignon 😏🙈'], flirt)).toEqual([]);
    expect(misuses(['t’es mignon 😏', 'oh 🙈', 'viens 🔥'], flirt)).toHaveLength(1);
  });

  it('never lets three emojis through, of one kind or more, even in a flirt', () => {
    expect(misuses(['haha 🙈🙈🙈'])).toHaveLength(1);
    expect(misuses(['haha 🙈🙈🙈'], flirt)).toHaveLength(1);
    expect(misuses(['oh 🙈🙈', 'viens 🔥'], flirt)).toHaveLength(1);
  });

  it('leaves the emoji out after her last answers all carried one', () => {
    const three = [['salut 😏'], ['ah bon', 'raconte 🙈'], ['trop bien ✨']];
    expect(misuses(['et toi ? 😏'], { ...calm, previousTurns: three })).toHaveLength(1);
    expect(misuses(['et toi ?'], { ...calm, previousTurns: three })).toEqual([]);
    // One of her last three without an emoji: the streak is broken.
    expect(
      misuses(['et toi ? 😏'], { ...calm, previousTurns: [['salut 😏'], ['ah bon'], ['top ✨']] }),
    ).toEqual([]);
    // Fewer answers than the streak: nothing to read yet.
    expect(misuses(['et toi ? 😏'], { ...calm, previousTurns: [['salut 😏'], ['top ✨']] })).toEqual([]);
  });

  it('reads the streak at her own setting', () => {
    const two = [['salut 😏'], ['top ✨']];
    expect(misuses(['et toi ? 😏'], { ...calm, streakMax: 2, previousTurns: two })).toHaveLength(1);
    expect(misuses(['et toi ? 😏'], { ...calm, streakMax: 3, previousTurns: two })).toEqual([]);
  });
});

describe('her emojis in the voice guards', () => {
  it('is soft and asks for one rewrite, read only on an answer in a conversation', () => {
    const context = { previousTurns: [] };
    const violations = checkVoiceOutput(['😏 coucou', 'ça va ? 🙈'], DEFAULT_GUARD_SETTINGS, context);
    expect(violations.filter((v) => v.code === 'emoji_misuse').length).toBeGreaterThan(0);
    expect(isBlocked(violations)).toBe(false);
    expect(wantsRewrite(violations)).toBe(true);
    // A lone sample of her bank, without a conversation, is not read for it.
    expect(checkVoiceOutput(['😏 coucou'], DEFAULT_GUARD_SETTINGS).map((v) => v.code)).not.toContain(
      'emoji_misuse',
    );
  });

  it('reads the flirt and her streak setting from the guards', () => {
    const turns = [['salut 😏'], ['top ✨']];
    const codes = (flirting: boolean, emojiStreakMax?: number) =>
      checkVoiceOutput(
        ['t’es mignon 😏', 'raconte 🙈'],
        { ...DEFAULT_GUARD_SETTINGS, ...(emojiStreakMax !== undefined && { emojiStreakMax }) },
        { previousTurns: turns, flirting },
      ).map((v) => v.code);
    expect(codes(false)).toContain('emoji_misuse');
    expect(codes(true)).not.toContain('emoji_misuse');
    expect(codes(true, 2)).toContain('emoji_misuse');
  });
});

describe('checkEmojiUse, for another surface of hers', () => {
  it('reads the same rule from her recent answers given as booleans', () => {
    const use = { flirting: false, recentWithEmoji: [true, true, true], streakMax: 3 };
    expect(checkEmojiUse(['merci 🙏'], use)).toHaveLength(1);
    expect(checkEmojiUse(['merci 🙏'], { ...use, recentWithEmoji: [true, false, true] })).toEqual([]);
    expect(checkEmojiUse(['🙏 merci'], { ...use, recentWithEmoji: [] })).toHaveLength(1);
    expect(checkEmojiUse(['merci 😏', 'bisous 🙈'], { ...use, recentWithEmoji: [], flirting: true })).toEqual(
      [],
    );
  });
});
