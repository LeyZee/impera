/**
 * Her questions in public (Charles, 26/11): a question now and then brings a conversation under her post, never on
 * every reply, where it would read as a bot fishing for engagement. The code decides which reply may carry one; the
 * model only uses the room it is given, and only when the comment opens a real conversation.
 */

/** One reply in `every` at most may ask a question, counted over her day; the agency's setting stays in these bounds. */
export const QUESTION_EVERY_BOUNDS = { min: 2, max: 10, default: 3 } as const;

/** The setting kept inside the code's bounds; a value outside them takes the nearest bound. */
export function boundedQuestionEvery(every: number): number {
  if (!Number.isFinite(every)) return QUESTION_EVERY_BOUNDS.default;
  return Math.min(QUESTION_EVERY_BOUNDS.max, Math.max(QUESTION_EVERY_BOUNDS.min, Math.round(every)));
}

/**
 * Whether the next reply may ask: her first of the day may, then one in `every` (a question at the 1st, 4th, 7th reply
 * for 3). Counted on her replies sent today, questions included.
 */
export function mayAskQuestion(
  day: { readonly replies: number; readonly questions: number },
  every: number,
): boolean {
  return day.questions * boundedQuestionEvery(every) <= day.replies;
}

/** A reply asks a question when it carries a question mark, full-width forms folded. */
export function asksAQuestion(text: string): boolean {
  return text.normalize('NFKC').includes('?');
}
