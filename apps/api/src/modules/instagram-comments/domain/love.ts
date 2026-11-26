/**
 * He tells her he loves her, or always has (the creator, 26/11): in public she answers with emojis only. Words would
 * make the others jealous, and he could imagine a story. Read by the code on the comment, never left to the model.
 */

// On the folded text: accents dropped, apostrophes and punctuation as spaces.
const LOVE = [
  /\bje t ?aime\b(?! bien)/u,
  /\bje t ai (toujours )?aimee?\b/u,
  /\bj t aime\b(?! bien)/u,
  /\bjtm\b/u,
  /\bje suis (tombe )?amoureux de toi\b/u,
  /\bi (love|luv) (you|u)\b/u,
  /\bi( ve| have)? always loved (you|u)\b/u,
  /\bi m in love with (you|u)\b/u,
  /\bti amo\b/u,
  /\bti voglio bene\b/u,
  /\bsono innamorato di te\b/u,
  /\bte (quiero|amo)\b/u,
  /\bestoy enamorado de ti\b/u,
];

function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Whether a comment declares love to her. */
export function declaresLove(comment: string): boolean {
  const folded = fold(comment);
  return LOVE.some((pattern) => pattern.test(folded));
}

/** A reply of emojis only: no letter and no digit. */
export function emojisOnly(reply: string): boolean {
  return !/[\p{L}\p{N}]/u.test(reply.normalize('NFKC').replace(/\p{Extended_Pictographic}/gu, ''));
}
