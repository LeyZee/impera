import { normalise } from '@impera/contracts';

import { CITY } from './guards';

/**
 * What turns a plain ask into something concrete (ADR 0143, bounds 22, 25 to 27 and 29): a place, a date, a time, a
 * price, a hint that he knows where she is, or pressure. Read by code, a closed rule: any doubt reads as concrete, so
 * the pause holds on his side and her answer is rewritten on hers. Pure.
 */

/** Words split on anything that is not a letter or a digit, apostrophes too, with a space at each end. */
const wordsOf = (text: string): string =>
  ` ${normalise(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;

// A place, a date, an address, or he hints he knows where she is (§ 27), read on `wordsOf`.
const PLACE_OR_DATE =
  /\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|apres demain|ce soir|cette nuit|ce week end|ce weekend|cette semaine|la semaine prochaine|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|\d{1,2} ?h|\d{5}|rue|avenue|boulevard|bd|place|gare|aeroport|hotel|bar|restaurant|resto|metro|station|parking|parc|plage|adresse|chez (?:toi|moi|lui|elle)|ta ville|ma ville|ton quartier|mon quartier|ton immeuble|ton travail|ton taf|ta fac|ta salle|ma salle|ton studio|mon studio|j habite|je suis a|je serai a|je passe a|je viens a|je monte a|je descends a|pres de chez|a cote de chez|je sais ou|je t ai (?:vue|croisee|apercue|reconnue)|je te reconnais|je te trouverai|code postal)\b/u;
const CITY_WORD = new RegExp(`\\b${CITY}\\b`, 'u');
// The only phrases where a preposition says no place (bound 26): taken out before the prepositions are read.
const NO_PLACE = /(?<= )(?:en vrai|en personne|un jour|a l occasion)(?= )/gu;
// A preposition of place (bound 27): « à », « au », « vers », « chez », « près de », « du côté de »…
const PLACE_PREPOSITION = / (?:a|au|aux|sur|vers|chez|dans|pres de|du cote de|cote de) /u;
// Where she comes from or lives: « t'es de Lyon ? », « tu viens d'où ? ».
const ORIGIN =
  / (?:t es de|tu es de|tu viens de|tu viens d|d ou|ou tu (?:habites|vis|es|bosses|travailles)) /u;
// Pressure, a threat or money (bounds 25, 26): « sinon je te retrouve », « je viens te chercher », « je paie ».
const PRESSURE =
  / (?:sinon|ou sinon|je te (?:re)?trouve(?:rai)?|te chercher|je (?:te )?(?:paie|paye|paierai|payerai)|combien|euro|euros|balles|eur|prix|tarif) /u;

/** A digit, a currency sign, or a word with a capital letter past the start of its sentence, read on his raw text. */
function rawSigns(text: string): boolean {
  if (/[\p{N}€$£]/u.test(text)) return true;
  return text
    .split(/[.!?…\n]+/u)
    .some((sentence) =>
      (sentence.match(/[\p{L}][\p{L}'’-]*/gu) ?? []).slice(1).some((w) => /^\p{Lu}/u.test(w)),
    );
}

/**
 * His message is not a plain ask (bounds 25 to 27): it names or hints at a place, a date, a time, money, or presses
 * her. Then no exception holds and her keyword pauses as before.
 */
export function notPlainAsk(text: string): boolean {
  const read = wordsOf(text);
  const prepositions = read.replace(NO_PLACE, ' ');
  return (
    rawSigns(text) ||
    PLACE_OR_DATE.test(read) ||
    CITY_WORD.test(read) ||
    PLACE_PREPOSITION.test(prepositions) ||
    ORIGIN.test(read) ||
    PRESSURE.test(read)
  );
}

/**
 * Her answer fixes something (bounds 22 and 29), on a turn where he asks to meet or she points him to her practice: a
 * date, a time, a place, a city, a price or an amount. Gives the first bubble that does, with what it matched.
 */
export function fixesSomething(
  bubbles: readonly string[],
): { readonly index: number; readonly match: string } | null {
  for (const [index, bubble] of bubbles.entries()) {
    const read = wordsOf(bubble);
    const match =
      /[\p{N}€$£]/u.exec(bubble)?.[0] ??
      PLACE_OR_DATE.exec(read)?.[0] ??
      CITY_WORD.exec(read)?.[0] ??
      / (?:euro|euros|balles|prix|tarif|gratuit) /u.exec(read)?.[0];
    if (match !== undefined) return { index, match: match.trim() };
  }
  return null;
}
