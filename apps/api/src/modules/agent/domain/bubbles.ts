/**
 * How many bubbles she may send, and how long each takes her to type (Charles, 16/11 à 0 h 09 : « trois bulles…
 * mais il faut pas qu'elle les envoie en même temps… Trois rarement »). Decided by code, never by the voice: up to
 * two by default, so a small laugh bubble may follow (Charles 21/11: never one bubble every time), three only when he
 * wrote long in two messages or more. Within it, she mirrors his rhythm (the voice's rule). The typing
 * delays are the same for the real send and the playground, so the playground shows the rhythm the fan will see.
 */
export type BubbleBudget = 1 | 2 | 3;

/** His message, or his messages together, from this length on: there is enough to answer in two bubbles. */
const LONG_MESSAGE_CHARS = 140;

/** The fan's messages since her last one, in order: what she answers now. */
function fanBurst(history: readonly { readonly from: 'fan' | 'creator'; readonly text: string }[]): string[] {
  const burst: string[] = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn?.from !== 'fan') break;
    burst.unshift(turn.text);
  }
  return burst;
}

/** The bubbles she may write this turn; one when nothing of his awaits (a follow-up). */
export function bubbleBudget(
  history: readonly { readonly from: 'fan' | 'creator'; readonly text: string }[],
  herMax = 3,
): BubbleBudget {
  const budget = budgetFor(history);
  return herMax <= 1 ? 1 : herMax === 2 && budget === 3 ? 2 : budget;
}

/** The bubbles his messages call for, before her own maximum. */
function budgetFor(
  history: readonly { readonly from: 'fan' | 'creator'; readonly text: string }[],
): BubbleBudget {
  // On what he wrote, never on how many times he pressed send: « ok » then « 😂 » is one short answer (audit du
  // 16/11, B1). Three only when he wrote long in two messages or more.
  const burst = fanBurst(history);
  const length = burst.reduce((sum, text) => sum + text.trim().length, 0);
  if (burst.length === 0) return 1;
  if (length < LONG_MESSAGE_CHARS) return 2;
  return burst.length >= 2 ? 3 : 2;
}

/**
 * Her bubbles within the budget: the first ones, what goes past it is left out. Glued to the last one, they would
 * make one bubble without punctuation, sometimes with two questions, which no one writes; a reply a little short is
 * human. The guards read what leaves, so nothing they should see escapes them.
 */
export function fitBubbles(bubbles: readonly string[], budget: BubbleBudget): readonly string[] {
  return bubbles.length <= budget ? bubbles : bubbles.slice(0, budget);
}

/** The pause before she starts typing a bubble, then her typing speed on a phone, then the longest wait. */
const TYPING_START_MS = 1_500;
const TYPING_MS_PER_CHAR = 150;
const TYPING_MAX_MS = 12_000;

/**
 * The time she takes to type each bubble, in milliseconds, the first included: the wait before it leaves, once the
 * one before it has left. Pure and without chance, so the real send and the playground give the same figures.
 */
export function bubbleDelays(bubbles: readonly string[]): readonly number[] {
  return bubbles.map((bubble) =>
    Math.min(TYPING_MAX_MS, TYPING_START_MS + charactersOf(bubble.trim()) * TYPING_MS_PER_CHAR),
  );
}

const GRAPHEMES = new Intl.Segmenter('fr', { granularity: 'grapheme' });

/** What she types, as she sees it: an emoji, accented or not, is one character. */
function charactersOf(text: string): number {
  return Array.from(GRAPHEMES.segment(text)).length;
}
