/**
 * The pace of getting to know him (Playground, Charles 16/11): no questionnaire. She stays on what he just said while
 * it lives, and how much she asks follows how much he writes. Code measures his words and her own habits; the voice
 * only reads the hints it gets (CLAUDE.md rule 3).
 */

/** At most this many words, he writes little: she keeps it going with an open question on what he said. */
const QUIET_WORDS = 6;
/** At least this many words, he tells a lot: she bounces on it and gives a bit of herself, asking little. */
const TALKATIVE_WORDS = 25;
/** An emoji in each of her last turns is a tic: she leaves it out this time. */
const EMOJI_STREAK = 2;

export const QUIET_FAN_HINT =
  'il écrit peu : finis sur une question ouverte à propos de ce qu’il vient de dire, pas une nouvelle question pour faire connaissance';
export const TALKATIVE_FAN_HINT =
  'il raconte volontiers : rebondis sur ce qu’il dit et confie un peu de toi, une question seulement si elle vient toute seule';

const EMOJI = /\p{Extended_Pictographic}/gu;

const wordsOf = (text: string): number =>
  text.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

function emojisOf(texts: readonly string[]): Set<string> {
  return new Set(texts.flatMap((text) => text.match(EMOJI) ?? []));
}

/**
 * The hints for her answer: how much to ask, from the words of his message(s) since her last answer, and the emojis
 * she used in each of her last turns, to leave out now. Her turns are her messages between two of his, oldest first.
 */
export function paceHints(fanText: string, herTurns: readonly (readonly string[])[]): string[] {
  const words = wordsOf(fanText);
  const asking =
    words <= QUIET_WORDS ? [QUIET_FAN_HINT] : words >= TALKATIVE_WORDS ? [TALKATIVE_FAN_HINT] : [];
  const last = herTurns.slice(-EMOJI_STREAK);
  if (last.length < EMOJI_STREAK) return asking;
  const [first, ...rest] = last.map(emojisOf);
  const tics = [...(first ?? [])].filter((emoji) => rest.every((turn) => turn.has(emoji)));
  return tics.length === 0 ? asking : [...asking, `pas de ${tics.join(' ')} cette fois, varie`];
}
