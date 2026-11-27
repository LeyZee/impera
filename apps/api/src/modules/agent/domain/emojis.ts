import type { GuardCode } from '@impera/contracts';

/**
 * Her emojis (Charles 26/11, « go voix », ADR 0158 § O), read on her whole answer, every bubble together: at the end of
 * a bubble only; one kind per answer, two once they flirt; never three emojis, the same one doubled (« 😂😂 ») counting
 * as one kind but two emojis; and not on every message: after her last `streakMax` answers all carried one, this one
 * carries none. Soft: her answer is written once more, then goes (`wantsRewrite`). Generic: no emoji of hers here.
 */

/** Her last this-many answers all carried an emoji: the next one carries none. A creator's persona may set her own. */
export const DEFAULT_EMOJI_STREAK_MAX = 3;
/** Never more emojis than this in one answer, of one kind or two. */
const EMOJIS_MAX = 2;
const KINDS_MAX = 1;
const KINDS_MAX_FLIRTING = 2;

export interface EmojiRules {
  /** They flirt now (a heated reading of his message, outside care): two kinds allowed instead of one. */
  readonly flirting: boolean;
  /** Her previous answers to him, oldest first, each her bubbles of one turn; absent, the streak is not read. */
  readonly previousTurns?: readonly (readonly string[])[];
  readonly streakMax: number;
}

export interface EmojiViolation {
  readonly code: GuardCode;
  readonly severity: 'soft';
  readonly bubbleIndex?: number;
  readonly match: string;
}

const segmenter = new Intl.Segmenter('fr', { granularity: 'grapheme' });
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/**
 * The emojis of a text, as typed, one per grapheme: a joined sequence (👩‍💻), a skin tone (👍🏽) or a flag is one. The
 * variation selector some keyboards add is left out, so « ❤ » and « ❤\uFE0F » are the same.
 */
export function emojisIn(text: string): string[] {
  return [...segmenter.segment(text)]
    .map((part) => part.segment)
    .filter((grapheme) => PICTOGRAPHIC.test(grapheme))
    .map((grapheme) => grapheme.replace(/\uFE0F/gu, ''));
}

/** The first emoji of a bubble with anything but an emoji or a space after it; undefined when all sit at the end. */
function misplacedEmoji(bubble: string): string | undefined {
  const graphemes = [...segmenter.segment(bubble)].map((part) => part.segment);
  const first = graphemes.findIndex((grapheme) => PICTOGRAPHIC.test(grapheme));
  if (first === -1) return undefined;
  const tailIsEmojis = graphemes.slice(first).every((g) => PICTOGRAPHIC.test(g) || /^\s+$/u.test(g));
  return tailIsEmojis ? undefined : graphemes[first]?.replace(/\uFE0F/gu, '');
}

/** Whether each of her answers carried an emoji, oldest first: what the streak reads. */
function withEmoji(turns: readonly (readonly string[])[]): boolean[] {
  return turns.map((turn) => turn.some((text) => emojisIn(text).length > 0));
}

function streakReached(recentWithEmoji: readonly boolean[], streakMax: number): boolean {
  const recent = recentWithEmoji.slice(-streakMax);
  return recent.length === streakMax && recent.every(Boolean);
}

/** Her last `streakMax` answers all carried an emoji: this one carries none (told to the voice before it writes). */
export function emojiStreakReached(
  previousTurns: readonly (readonly string[])[],
  streakMax: number,
): boolean {
  return streakReached(withEmoji(previousTurns), streakMax);
}

/** What `checkEmojiUse` reads besides her bubbles: any surface of hers (chat, a public reply) gives the same. */
export interface EmojiUse {
  readonly flirting: boolean;
  /** Whether each of her last answers carried an emoji, oldest first; fewer than `streakMax`, the streak is not read. */
  readonly recentWithEmoji: readonly boolean[];
  readonly streakMax: number;
}

export function checkEmojis(bubbles: readonly string[], rules: EmojiRules): EmojiViolation[] {
  return checkEmojiUse(bubbles, {
    flirting: rules.flirting,
    recentWithEmoji: withEmoji(rules.previousTurns ?? []),
    streakMax: rules.streakMax,
  });
}

/**
 * The emoji rule as one pure function (Charles 26/11): placement, kinds, three at most, the streak. The chat reads it
 * through `checkEmojis`; another surface of hers (her public replies) calls it with her own recent answers.
 */
export function checkEmojiUse(bubbles: readonly string[], use: EmojiUse): EmojiViolation[] {
  const violations: EmojiViolation[] = [];
  bubbles.forEach((bubble, bubbleIndex) => {
    const misplaced = misplacedEmoji(bubble);
    if (misplaced !== undefined)
      violations.push({ code: 'emoji_misuse', severity: 'soft', bubbleIndex, match: misplaced });
  });
  const all = bubbles.flatMap(emojisIn);
  if (all.length === 0) return violations;
  const kinds = [...new Set(all)];
  if (all.length > EMOJIS_MAX || kinds.length > (use.flirting ? KINDS_MAX_FLIRTING : KINDS_MAX)) {
    violations.push({ code: 'emoji_misuse', severity: 'soft', match: all.join('') });
  }
  if (streakReached(use.recentWithEmoji, use.streakMax)) {
    violations.push({ code: 'emoji_misuse', severity: 'soft', match: kinds.join('') });
  }
  return violations;
}
