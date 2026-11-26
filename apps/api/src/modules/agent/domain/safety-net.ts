import { normalise, normaliseWords } from '@impera/contracts';

import { namesYouth } from './forbidden-themes';
import { checkExplicit } from './guards';

/**
 * The safety net in code (recette AGT-01, Charles « ok filet sécurité », 06/11 18h41): what he wrote himself says he
 * is a minor, or that he wants to hurt himself, and a human answers him before any model reads it. The brain still
 * reads the risks it alone can see; this net only catches what is written plainly, so that a model's miss never
 * leaves the bot chatting with a minor or a fan in danger. A false alarm costs one handoff to a chatter. A fantasy of
 * his that puts a child or a minor in a sexual act (`minor_fantasy`, Charles 26/11 at 23:45) is read the same way and
 * has the same effect as a doubt on his age.
 */
export type SafetySign = 'minor_suspected' | 'minor_fantasy' | 'self_harm';

// An age under 18, in digits or in words: « 16 », « seize », « dix-sept ».
const UNDER_18 = '(?:1[0-7]|[1-9]|onze|douze|treize|quatorze|quinze|seize|dix(?:[ -]?sept)?)';
// The unit after it: « ans », « piges ». The slang ones (« balais », « berges ») only from ten: « 5 balais » are brooms.
const YEARS = '(?:ans?|yo|piges?)';
const TEENS = '(?:1[0-7]|onze|douze|treize|quatorze|quinze|seize|dix(?:[ -]?sept)?)';
const SLANG_YEARS = '(?:balais|berges|printemps)';
// Not his age: « 16 ans d'expérience », « dix ans que j'habite ici ».
const NOT_AGE = "(?!\\s*(?:d'|de |d |que |qu'))";
// He gives his own age under 18: « j'ai 16 ans », « moi 15 ans », « 16 ans et toi ? » at the start, « i'm 16 ».
// « J'ai 16 ans d'expérience » and « ma fille a 16 ans » are not his age.
const MINOR_AGE = [
  new RegExp(
    `\\b(?:j(?:'| )?ai|moi|je suis age de|je suis agee de|age ?:?)\\s*(?:${UNDER_18}\\s*${YEARS}|${TEENS}\\s*${SLANG_YEARS})\\b${NOT_AGE}`,
    'u',
  ),
  new RegExp(`^\\s*(?:${UNDER_18}\\s*${YEARS}|${TEENS}\\s*${SLANG_YEARS})\\b${NOT_AGE}`, 'u'),
  // He is about to turn 18: « je vais avoir 18 ans », « j'aurai 18 ans le mois prochain », « bientôt 18 ans ». Not
  // « bientôt 18 h » nor « presque 18 ans de mariage ».
  new RegExp(
    `\\b(?:je vais avoir|j'?vais avoir|j'?aurai|bientot|presque|pas tout a fait) 18 ?ans?\\b${NOT_AGE}`,
    'u',
  ),
  /\bi'?m\s*(?:1[0-7]|[1-9])\b(?!\s*(?:years? of|yrs? of|h|:))/u,
  /\b(?:1[0-7]|[1-9])\s*(?:yo|y\/o|years? old)\b/u,
];
// He says he is a minor, in so many words.
const MINOR_WORDS = [
  /\b(?:je suis|j'?suis|chui) (?:encore )?mineure?\b/u,
  /\b(?:je suis|j'?suis|chui) (?:encore )?(?:au college|en (?:6|5|4|3)e?me\b|en (?:sixieme|cinquieme|quatrieme|troisieme)\b|en seconde\b(?!\s+(?:position|place|fois|main|zone|chance|partie)))/u,
  /\bj(?:'| )?ai pas (?:encore )?18 ans\b/u,
  /\bpas encore majeure?\b/u,
];
// Where a minor is: middle school, a minor's class, a birth year. Read clause by clause, and not in a clause about
// his child or his pupils (« mon fils est en 4e », « je suis prof en 3e »).
const MINOR_PLACES = [
  // A minor's class or school, his own: « en 4e », « lycéen », « je suis au lycée ». Not a rank (« en 3e position »),
  // a year of study (« en 3e année ») or his past (« quand j'étais lycéen »).
  /(?<!etais |etait )\ben (?:6|5|4|3)e?(?:me)?\b(?!\s*(?:position|place|rang|vitesse|fois|ligne|annee|etage|div|semaine|jour|round|periode|mi-temps|de |d'))/u,
  /(?<!etais |etait |ancien |ancienne )\b(?:lyceen|lyceenne|collegien|collegienne)\b/u,
  /\b(?:je suis|j'?suis|jsuis|chui) (?:encore )?(?:au lycee|en terminale\b(?!\s+(?:de |d'))|en premiere\b(?!\s+(?:position|place|fois|ligne|annee|classe|de |d')))/u,
];
const SOMEONE_ELSE =
  /\b(?:mon|ma|mes|son|sa|ses|notre|nos|un|une|le|la|les) (?:fils|fille|filles|gamin|gamine|gamins|enfant|enfants|neveu|niece|gosse|gosses|petit|petite|frere|soeur|ado|ados|eleve|eleves|boite|societe|entreprise)\b|\b(?:prof|professeur|professeure|enseignant|enseignante|j'?enseigne|surveillant|surveillante|cpe|instit|maitre|maitresse)\b/u;

/** A clause of his, about himself: his child's class or his pupils' are not his. */
function clausesOfHis(text: string): string[] {
  return text.split(/[.,;!?\n]+/u).filter((clause) => !SOMEONE_ELSE.test(clause));
}

/** Born in or after this year, he may be a minor: 18 years before this one, the doubt counting against him. */
function bornMinor(text: string, year: number): boolean {
  const born = /\bnee? en ((?:19|20)\d\d)\b/u.exec(text)?.[1];
  return born !== undefined && Number(born) >= year - 18 && Number(born) <= year;
}
// He speaks of ending his life or hurting himself, in his own words.
const SELF_HARM = [
  /\b(?:me|m') ?suicider\b/u,
  /\bsuicide\b/u,
  /\b(?:veux|vais|envie d'|envie de|prefere) ?en finir\b/u,
  /\ben finir avec (?:la vie|tout|ma vie)\b/u,
  /\b(?:plus|pas) envie de vivre\b/u,
  /\bmettre fin a (?:mes jours|ma vie)\b/u,
  /\b(?:je veux|j'?ai envie de|je vais) (?:mourir|me tuer|crever)\b/u,
  /\bme (?:faire du mal|scarifier|couper les veines|mutiler|pendre|jeter sous)\b/u,
  /\bkill myself\b|\bwant to die\b/u,
  /\bme foutre en l'?air\b/u,
  /\bm'?ouvrir les veines\b/u,
  /\bidees noires\b(?!\s+pour)/u,
  /\bme (?:tirer une balle|jeter d'un pont|jeter par la fenetre|jeter sous un train)\b/u,
];

// A sexual message of his, in neutral words (fr/en/it/es), or one explicit by the guards' own words. A role he asks
// her to play counts: « joue une … pour moi ».
const SEXUAL_WORDS =
  /\b(sexe|sexuel(le)?s?|sexy|faire l amour|coucher avec|couche avec|nue?s?|excitee?s?|envie de toi|caresser|au lit|fantasmes?|fantasmer|fantasme sur|joue[rsz]? (une?|la|le)|jeu de role|sex|sexual|make love|making love|naked|nude|horny|in bed|turned on|fantasy|fantasize|fantasise|roleplay|role play|fare l amore|nud[ao]|eccitat[oa]|a letto|sesso|fantasia|gioco di ruolo|hacer el amor|desnud[oa]|excitad[oa]|en la cama|sexo|fantasias?|juego de rol)\b/u;
// A length of time is no age: « marié depuis 15 ans », « 15 ans de mariage », « for 15 years », « hace 15 años ».
const AGE_NUMBER =
  '(?:1[0-7]|[1-9]|onze|douze|treize|quatorze|quinze|seize|dix sept|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)';
const AGE_UNIT = '(?:ans?|years?|anni|anos)';
const DURATION = new RegExp(
  `\\b(?:depuis|il y a|pendant|fait|for|since|da|desde|hace|durante|per) ${AGE_NUMBER} ?${AGE_UNIT}\\b|\\b${AGE_NUMBER} ?${AGE_UNIT} (?:de|d|que|qu|of|ago|fa|di|en)\\b`,
  'gu',
);

/**
 * He puts a child or a minor in a sexual act, told, wished or asked of her as a role, of himself or of someone else: a
 * word of youth or of a minor, a school role or an age under 18, in a sexual message. Procreation between adults
 * (« te faire un enfant »), « ma petite » said to her, a « petite robe » or a game of age with no minor's word (« prof
 * et étudiante ») are left. In doubt, a human: a false alarm costs a handoff.
 */
function minorFantasy(fanText: string): boolean {
  const words = normaliseWords(fanText);
  const sexual = SEXUAL_WORDS.test(words) || checkExplicit([fanText]).length > 0;
  return sexual && namesYouth(words.replace(DURATION, ' '), fanText);
}

/**
 * The signs his own words carry, the gravest first; none when nothing is written plainly. A birth year is read
 * against `now`'s year.
 */
export function safetySigns(fanText: string, now: Date = new Date()): SafetySign[] {
  const text = normalise(fanText);
  const signs: SafetySign[] = [];
  const his = clausesOfHis(text);
  if (
    [...MINOR_AGE, ...MINOR_WORDS].some((pattern) => pattern.test(text)) ||
    his.some(
      (clause) =>
        MINOR_PLACES.some((pattern) => pattern.test(clause)) || bornMinor(clause, now.getUTCFullYear()),
    )
  )
    signs.push('minor_suspected');
  if (minorFantasy(fanText)) signs.push('minor_fantasy');
  if (SELF_HARM.some((pattern) => pattern.test(text))) signs.push('self_harm');
  return signs;
}
