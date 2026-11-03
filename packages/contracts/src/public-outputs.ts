import { normaliseWords } from './normalise';

/**
 * What a text meant for a public output must never say (ADR 0055 § 1, ADR 0057 § 6), read in the code and never left
 * to a prompt: the trend watch's ideas (ADR 0060 § 4) and, later, the captions of the publication (PUB-01) read the same
 * lists. Words are compared as `normaliseWords` reads them, whole words only.
 */

/** « Jamais de nu » on every public output (ADR 0055 § 1, the chatting method): the words that say it. */
const NUDITY_WORDS: readonly string[] = [
  'nu',
  'nue',
  'nus',
  'nues',
  'nude',
  'nudes',
  'nudite',
  'naked',
  'topless',
  'seins nus',
  'a poil',
  'tout nu',
  'toute nue',
  'sans culotte',
  'sans soutien gorge',
];

/** The adult platforms Instagram must never hear of (ADR 0057 § 6). */
const ADULT_PLATFORMS: readonly string[] = [
  'reveal',
  'reveal me',
  'onlyfans',
  'only fans',
  'mym',
  'fansly',
  'fanvue',
  'patreon',
  'lien en bio',
  'link in bio',
  'lien dans ma bio',
];

/** The most keywords an Instagram text may carry (ADR 0057 § 6). */
export const INSTAGRAM_KEYWORDS_MAX = 5;

const LINK = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|fr|me|io|net|org|link|ly|bio)\b/iu;
const PRICE = /\d\s*(?:€|eur\b|euros?\b|\$|usd\b)|[€$]\s*\d/iu;
const HASHTAG = /#[\p{L}\p{N}_]+/gu;

function hasWords(text: string, words: readonly string[]): string | null {
  const haystack = ` ${normaliseWords(text)} `;
  return words.find((word) => haystack.includes(` ${normaliseWords(word)} `)) ?? null;
}

/** Why a text breaks « jamais de nu » (the word found), or null. */
export function nudityIn(text: string): string | null {
  return hasWords(text, NUDITY_WORDS);
}

/** What the Instagram guard finds in a text (ADR 0057 § 6): an adult platform, a link, a price, too many keywords. */
export type InstagramFault = 'adult_platform' | 'link' | 'price' | 'too_many_keywords';

/** The faults of a text bound for Instagram, empty when it passes. Its length is bounded by its own schema. */
export function instagramFaults(text: string): InstagramFault[] {
  const faults: InstagramFault[] = [];
  if (hasWords(text, ADULT_PLATFORMS) !== null) faults.push('adult_platform');
  if (LINK.test(text)) faults.push('link');
  if (PRICE.test(text)) faults.push('price');
  if ((text.match(HASHTAG) ?? []).length > INSTAGRAM_KEYWORDS_MAX) faults.push('too_many_keywords');
  return faults;
}
