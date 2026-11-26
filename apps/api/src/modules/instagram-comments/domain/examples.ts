/**
 * Her real replies as examples (Charles, 26/11): for each new comment, the code picks the pairs « comment, her reply »
 * whose comment reads closest, so the model sees how she answered the same kind of thing. Picked by the code, by
 * closeness of text: no call to a model, nothing paid. Her replies are read as examples of a tone, never copied.
 */

/** A pair of her bank: a comment she received and what she answered, the authors' handles already removed. */
export interface CommentExample {
  readonly id: string;
  readonly comment: string;
  readonly reply: string;
}

/** How many of her pairs go with one comment: enough to show a tone, few enough to keep the call short. */
const NEAR_EXAMPLES = 5;

function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/(\p{L})\1{2,}/gu, '$1$1')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** The text's pieces: three letters at a time across its words, and each emoji on its own. */
function pieces(text: string): Set<string> {
  const folded = fold(text);
  const out = new Set<string>();
  for (const emoji of folded.match(/\p{Extended_Pictographic}/gu) ?? []) out.add(emoji);
  const letters = ` ${folded.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  for (let at = 0; at + 3 <= letters.length; at += 1) out.add(letters.slice(at, at + 3));
  return out;
}

function closeness(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const piece of left) if (right.has(piece)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * The pairs of her bank whose comment reads closest to `comment`, closest first; two pairs where she answered the
 * same words count once, so the few shown are not one reply repeated. Ties go to the pair listed first.
 */
export function nearExamples(
  comment: string,
  bank: readonly CommentExample[],
  count: number = NEAR_EXAMPLES,
): CommentExample[] {
  const wanted = pieces(comment);
  const ranked = bank
    .map((example, index) => ({ example, index, score: closeness(wanted, pieces(example.comment)) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const picked: CommentExample[] = [];
  const replies = new Set<string>();
  for (const { example } of ranked) {
    if (picked.length >= count) break;
    const reply = fold(example.reply);
    if (replies.has(reply)) continue;
    replies.add(reply);
    picked.push(example);
  }
  return picked;
}
