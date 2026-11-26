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
 * variation selector some keyboards add is left out, so « ❤ » and « ❤️ » are the same.
 */
export function emojisIn(text: string): string[] {
  return [...segmenter.segment(text)]
    .map((part) => part.segment)
    .filter((grapheme) => PICTOGRAPHIC.test(grapheme))
    .map((grapheme) => grapheme.replace(/️/gu, ''));
}

/** The first emoji of a bubble with anything but an emoji or a space after it; undefined when all sit at the end. */
function misplacedEmoji(bubble: string): string | undefined {
  const graphemes = [...segmenter.segment(bubble)].map((part) => part.segment);
  const first = graphemes.findIndex((grapheme) => PICTOGRAPHIC.test(grapheme));
  if (first === -1) return undefined;
  const tailIsEmojis = graphemes.slice(first).every((g) => PICTOGRAPHIC.test(g) || /^\s+$/u.test(g));
  return tailIsEmojis ? undefined : graphemes[first]?.replace(/️/gu, '');
}

export function checkEmojis(bubbles: readonly string[], rules: EmojiRules): EmojiViolation[] {
  const violations: EmojiViolation[] = [];
  bubbles.forEach((bubble, bubbleIndex) => {
    const misplaced = misplacedEmoji(bubble);
    if (misplaced !== undefined)
      violations.push({ code: 'emoji_misuse', severity: 'soft', bubbleIndex, match: misplaced });
  });
  const all = bubbles.flatMap(emojisIn);
  if (all.length === 0) return violations;
  const kinds = [...new Set(all)];
  if (all.length > EMOJIS_MAX || kinds.length > (rules.flirting ? KINDS_MAX_FLIRTING : KINDS_MAX)) {
    violations.push({ code: 'emoji_misuse', severity: 'soft', match: all.join('') });
  }
  const recent = rules.previousTurns?.slice(-rules.streakMax) ?? [];
  if (recent.length === rules.streakMax && recent.every((turn) => turn.some((t) => emojisIn(t).length > 0))) {
    violations.push({ code: 'emoji_misuse', severity: 'soft', match: kinds.join('') });
  }
  return violations;
}
