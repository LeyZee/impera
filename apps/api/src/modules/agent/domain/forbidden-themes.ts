import { normaliseWords } from '@impera/contracts';

import { MINOR_REFERENCE, YOUTH_WORDS, YOUTH_WORDS_ACCENTED } from './guards';

/**
 * Themes no desire map ever plays (Sécurité, #1043): youth, the absence of consent, the family, an animal. Universal,
 * in code and whatever her persona says: an item of his map (a fantasy, an outfit, a word that works on him) that
 * touches one is never played, never taken as a script's target, never given to the voice. Read before her own limits
 * (`withoutHerLimits`). The lists name themes in neutral words, in French, English, Italian and Spanish, on the
 * normalised text (no accents, hyphens and apostrophes read as spaces).
 */
export type ForbiddenTheme = 'youth' | 'no_consent' | 'family' | 'animal';

/** Youth beyond the guards' words: school roles and uniforms. « Petite » alone stays (« petite robe »). */
const YOUTH_ROLES =
  /\b(eleves?|ecole|scolaire|school ?uniforms?|pupils?|scolarett[ae]|studentess[ae]|colegialas?|alumnas?)\b/;

/** An age under 18, in digits or in words, as a partner's or a role's: « 15 ans », « 16 years old », « 17 anni ». */
const MINOR_AGE_WORDS =
  /\b(1[0-7]|[1-9]|onze|douze|treize|quatorze|quinze|seize|dix sept|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen) ?(ans?|years? old|yo|y o|anni|anos)\b/u;

const NO_CONSENT =
  /\b(viols?|violer|violee?s?|de force|forcee?s?|forcer|contre son gre|sans (son )?consentement|non consentante?s?|endormie?s?|pendant son sommeil|inconsciente?s?|droguee?s?|ivre morte?|rape[ds]?|raping|forced|non ?consensual|unconscious|asleep|sleeping|drugged|passed out|stupro|violentata|forzata|addormentata|drogata|incosciente|violacion|violada|forzada|dormida|drogada|inconsciente)\b/;

const FAMILY =
  /\b(incestes?|incestueuse?|demi (s(oe|œ)ur|frere)|belle (mere|s(oe|œ)ur|fille)|beau (pere|frere|fils)|s(oe|œ)urs?|freres?|mere|pere|maman|papa|cousine?s?|tante|oncle|niece|neveu|incest|step ?(sister|brother|mom|mother|dad|father|daughter|son)|sisters?|brothers?|mom|mommy|mother|dad|daddy|father|aunt|uncle|cousins?|niece|nephew|incesto|sorella|fratello|madre|padre|matrigna|patrigno|cugina|zia|hermana|hermano|madrastra|padrastro|tia)\b/;

const ANIMAL =
  /\b(animal|animale|animaux|zoophilie|bestialite|chiens?|chevaux|cheval|animals?|bestiality|zoophilia|dogs?|horses?|animali|zoofilia|cavallo|animales|perros?|caballos?)\b/;

// Procreation between adults stays playable (Charles 26/11 at 23:45): a child or a baby right after a verb of making
// one (« te faire un enfant », « te remplir pour te faire un bébé », « give you a baby », « hacerte un bebé ») is no
// minor. Only a pronoun, « pour te faire » and an article may stand between: a longer phrase is read as it is. « Une
// enfant » is a girl, never a birth: the feminine article is left out.
const PROCREATION = new RegExp(
  [
    '\\b(?:fais|faire|fait|ferai|ferais|avoir|aurai|veux|voudrais|porter|porte|porterai|mettre|mets|met|remplir|remplis',
    '|engrosser|donner|donne|donnerai|make|making|have|having|give|giving|carry|carrying|fare|avere|dare|hacer|hacerte',
    '|tener|dar|darte)',
    '(?: (?:te|me|lui|vous|nous|t|m|you|me|her|ti|mi|le|toi|moi))?',
    '(?: pour (?:te|me|lui|vous|nous|t|m) faire)?',
    '(?: (?:un|des|mon|ton|son|notre|votre|nos|vos|a|an|your|my|our|uno|tuo|mio|nostro|tu|mi|nuestro))?',
    ' (?:enfants?|bebes?|babies|baby|child|children|kids?|figli[oa]?|bambin[aeio]|hij[oa]s?)\\b',
  ].join(''),
  'gu',
);

/** His words without what speaks of making a child between adults: procreation is no word of youth. */
function withoutProcreation(words: string): string {
  return words.replace(PROCREATION, ' ');
}

/**
 * Words of youth, « petite » alone left out in each language (« piccola », « pequeña »): a « petite robe » is a dress,
 * « ma petite » a pet name of hers.
 */
const youthWords = new RegExp(YOUTH_WORDS.source, 'g');
const BARE_SMALL = /^(petites?|piccol[ae]|pequeñ[ao]s?)$/iu;
const isBarePetite = (word: string) => BARE_SMALL.test(word);

/**
 * Whether a text names youth: a word of youth or of a minor, a school role, an age under 18; procreation between
 * adults and « petite » alone left out. `raw` is the text as written, for the accented words `normalise` would blur.
 */
export function namesYouth(text: string, raw: string = text): boolean {
  const adultWords = withoutProcreation(normaliseWords(text));
  return (
    MINOR_REFERENCE.test(adultWords) ||
    [...adultWords.matchAll(youthWords)].some((match) => !isBarePetite(match[0])) ||
    !isBarePetite(YOUTH_WORDS_ACCENTED.exec(raw)?.[2] ?? 'petite') ||
    YOUTH_ROLES.test(adultWords) ||
    MINOR_AGE_WORDS.test(adultWords)
  );
}

/** The forbidden theme an item touches, or `null`. */
export function forbiddenThemeOf(item: string): ForbiddenTheme | null {
  const words = normaliseWords(item);
  const youth = namesYouth(item);
  if (youth) return 'youth';
  if (NO_CONSENT.test(words)) return 'no_consent';
  if (FAMILY.test(words)) return 'family';
  if (ANIMAL.test(words)) return 'animal';
  return null;
}

/** The parts of his map that are played: a fantasy, an outfit, a word that works on him. */
interface PlayedItems {
  readonly desires: readonly string[];
  readonly outfits: readonly string[];
  readonly wordsThatWork: readonly string[];
}

/** His map without what touches a forbidden theme. His limits and what cools him stay: they only ever keep away. */
export function withoutForbiddenThemes<M extends PlayedItems>(map: M): M {
  const keep = (items: readonly string[]) => items.filter((item) => forbiddenThemeOf(item) === null);
  return {
    ...map,
    desires: keep(map.desires),
    outfits: keep(map.outfits),
    wordsThatWork: keep(map.wordsThatWork),
  };
}
