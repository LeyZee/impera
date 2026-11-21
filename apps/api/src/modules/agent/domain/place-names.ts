import { normaliseWords, unmask } from '@impera/contracts';

import type { GuardViolation } from './guards';

/**
 * The words of an answer that never name a place by themselves: articles, prepositions, and the kinds of home or
 * area (« Un petit appartement sous les toits, région … » keeps only what follows « région »). Folded as
 * `normaliseWords` folds them.
 */
const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'a',
  'au',
  'aux',
  'chez',
  'd',
  'dans',
  'de',
  'des',
  'du',
  'en',
  'et',
  'l',
  'la',
  'le',
  'les',
  'ou',
  'pres',
  'sous',
  'sur',
  'un',
  'une',
  'vers',
  'petit',
  'petite',
  'grand',
  'grande',
  'vieux',
  'vieille',
  'joli',
  'jolie',
  'appartement',
  'appart',
  'maison',
  'studio',
  'chambre',
  'loft',
  'toit',
  'toits',
  'residence',
  'colocation',
  'coloc',
  'region',
  'centre',
  'ville',
  'quartier',
  'banlieue',
  'campagne',
  'village',
  'bord',
  'mer',
  'montagne',
  'lac',
  'nord',
  'sud',
  'est',
  'ouest',
]);

/** A name shorter than this is never read as a place: it would match ordinary words. */
const MIN_PLACE_CHARS = 3;

/**
 * Her place names, from the answers that say where she lives (her town, her « lieu de vie »), as the public guard
 * reads them (garde des lieux, ADR 0080 § 5.9): each answer cut on its punctuation, its generic words dropped, and
 * every run of the words left kept as one name, folded (no accents, lower case); a hyphenated name stays whole, so
 * « Port-Sénac » gives « port senac ».
 * Her country is not read: a country names no one's door, and she may say it in public.
 */
export function placeNames(answers: readonly (string | null)[]): string[] {
  const names = new Set<string>();
  for (const answer of answers) {
    if (answer === null) continue;
    for (const part of answer.split(/[,;/()|·•]+/u)) {
      let run: string[] = [];
      const keep = (): void => {
        const name = run.join(' ');
        if (name.length >= MIN_PLACE_CHARS) names.add(name);
        run = [];
      };
      // A hyphenated name is one word, generic words inside it included (« Saint-Aubert-des-Brumes »).
      for (const written of part.split(/\s+/u)) {
        const word = normaliseWords(written);
        if (word === '' || GENERIC_WORDS.has(word)) keep();
        else run.push(word);
      }
      keep();
    }
  }
  return [...names];
}

const spaced = (text: string): string => ` ${text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/**
 * A public text that names one of her places is never published (garde des lieux, ADR 0080 § 5.9): the name as a
 * whole word or phrase, accents and case aside, also when masked with digits (« Valbrum3 »). A word made from it
 * (« Valbrumoise ») is not caught: that is left to the prompt, which never names a place.
 */
export function checkPlaceNames(texts: readonly string[], places: readonly string[]): GuardViolation[] {
  const violations: GuardViolation[] = [];
  texts.forEach((text, bubbleIndex) => {
    const readings = [normaliseWords(text), unmask(text)].map(spaced);
    const place = places.find((name) => readings.some((reading) => reading.includes(` ${name} `)));
    if (place !== undefined)
      violations.push({ code: 'place_named', severity: 'blocking', bubbleIndex, match: place });
  });
  return violations;
}
