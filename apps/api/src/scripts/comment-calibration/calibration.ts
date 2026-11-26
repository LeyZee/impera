import { z } from 'zod';

/**
 * The calibration of her replies to comments (Charles, 26/11): some of her real pairs are set aside, the model answers
 * their comments from the rest, and his answers are compared with hers. Run on his PC only: her words never leave it.
 * What may leave it are the counts below, which hold no text.
 */

/**
 * One line of her prepared corpus (« Voix de … », Corpus.jsonl): a fan's comment under one of her posts and all she
 * answered to it. Every key is always there. Handles (`destinataire`, @mentions) are removed before anything else.
 */
export const CorpusLineSchema = z.strictObject({
  id: z.string().regex(/^[RP]\d{4}$/u),
  date: z.iso.date(),
  support: z.enum(['Reel', 'Photo ou carrousel']),
  publication: z.string(),
  commentaire: z.string(),
  reponses: z
    .array(z.strictObject({ date: z.iso.date(), destinataire: z.string(), texte: z.string() }))
    .min(1),
});
export type CorpusLine = z.infer<typeof CorpusLineSchema>;

/** A pair « comment, her reply », as the calibration reads it: handles removed, her caption beside. */
export interface CalibrationPair {
  readonly comment: string;
  readonly reply: string;
  readonly mediaKind: 'reel' | 'photo';
  readonly caption: string;
}

const MENTION = /@[\p{L}\p{N}_.]+/gu;
const tidy = (text: string): string =>
  text.normalize('NFKC').replace(MENTION, ' ').replace(/\s+/gu, ' ').trim();

/** Her first reply to each comment: the one the blind test compares with; a comment left empty by the cleaning is dropped. */
export function pairOfCorpusLine(line: CorpusLine): CalibrationPair | null {
  const comment = tidy(line.commentaire);
  const reply = tidy(line.reponses[0]?.texte ?? '');
  if (comment === '' || reply === '') return null;
  return {
    comment,
    reply,
    mediaKind: line.support === 'Reel' ? 'reel' : 'photo',
    caption: tidy(line.publication),
  };
}

/** A deterministic shuffle (mulberry32): the same seed sets the same pairs aside, so two runs compare. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const out = [...items];
  for (let at = out.length - 1; at > 0; at -= 1) {
    const other = Math.floor(next() * (at + 1));
    const kept = out[at];
    const moved = out[other];
    if (kept === undefined || moved === undefined) continue;
    out[at] = moved;
    out[other] = kept;
  }
  return out;
}

/** `count` pairs set aside for the test, the rest as her bank; the test never sees its own pair among the examples. */
export function setAside(
  pairs: readonly CalibrationPair[],
  count: number,
  seed: number,
): { readonly test: CalibrationPair[]; readonly bank: CalibrationPair[] } {
  // A pair she gave twice counts once: the test never finds its own words among the examples.
  const seen = new Set<string>();
  const unique = pairs.filter((pair) => {
    const key = `${pair.comment}\u0000${pair.reply}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const all = shuffled(unique, seed);
  return { test: all.slice(0, count), bank: all.slice(count) };
}

const EMOJI = /\p{Extended_Pictographic}/gu;
const GRAPHEMES = new Intl.Segmenter('fr', { granularity: 'grapheme' });

/** What a set of replies looks like, in numbers only: nothing here quotes a word. */
export interface ReplyShape {
  readonly replies: number;
  readonly medianChars: number;
  /** Share of replies with no emoji, one, two, three or more. */
  readonly emojis: {
    readonly none: number;
    readonly one: number;
    readonly two: number;
    readonly more: number;
  };
  readonly withQuestion: number;
  readonly withExclamation: number;
  readonly startsUppercase: number;
}

function share(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 100) / 100;
}

export function shapeOf(replies: readonly string[]): ReplyShape {
  const lengths = replies
    .map((reply) => Array.from(GRAPHEMES.segment(reply)).length)
    .sort((left, right) => left - right);
  const middle = lengths.length === 0 ? 0 : (lengths[Math.floor((lengths.length - 1) / 2)] ?? 0);
  const emojiCounts = replies.map((reply) => (reply.match(EMOJI) ?? []).length);
  const total = replies.length;
  return {
    replies: total,
    medianChars: middle,
    emojis: {
      none: share(emojiCounts.filter((n) => n === 0).length, total),
      one: share(emojiCounts.filter((n) => n === 1).length, total),
      two: share(emojiCounts.filter((n) => n === 2).length, total),
      more: share(emojiCounts.filter((n) => n > 2).length, total),
    },
    withQuestion: share(replies.filter((reply) => reply.normalize('NFKC').includes('?')).length, total),
    withExclamation: share(replies.filter((reply) => reply.includes('!')).length, total),
    startsUppercase: share(replies.filter((reply) => /^\p{Lu}/u.test(reply.trim())).length, total),
  };
}

/** One line of the blind sheet: the two replies in an order drawn per line, the key kept apart. */
export interface BlindLine {
  readonly comment: string;
  readonly a: string;
  readonly b: string;
  /** Which of A or B is hers: in the key file only. */
  readonly hers: 'A' | 'B';
}

export function blindLines(
  rows: readonly { readonly comment: string; readonly hers: string; readonly model: string }[],
  seed: number,
): BlindLine[] {
  const coins = shuffled(
    rows.map((_, index) => index % 2 === 0),
    seed ^ 0x5bd1e995,
  );
  return rows.map((row, index) =>
    coins[index] === true
      ? { comment: row.comment, a: row.hers, b: row.model, hers: 'A' }
      : { comment: row.comment, a: row.model, b: row.hers, hers: 'B' },
  );
}
