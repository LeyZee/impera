import { normalise, normaliseWords } from '@impera/contracts';

import { checkExplicit, withoutProcreation } from './guards';

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
  // « Mineur de fond » is a trade.
  /\b(?:je suis|j'?suis|chui) (?:encore )?mineure?\b(?! de fond| de charbon| dans)/u,
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
// His trade at a school or a minor's word that is a trade: « je suis prof », « je bosse au lycée », « surveillant ».
const HIS_TRADE =
  /\b(?:je suis|j'?suis|jsuis|chui|je bosse|je travaille|je taffe)(?: (?:comme|en tant que))? (?:prof|professeur|professeure|enseignant|enseignante|surveillant|surveillante|cpe|proviseur|principal|principale|documentaliste|aed|instit|maitre|maitresse|agent|cuisinier|cuisiniere|infirmier|infirmiere)\b|\b(?:je bosse|je travaille|je taffe|j'?enseigne) (?:au|dans un|dans une|en) (?:lycee|college|ecole)\b/u;
// Set phrases that name death or harm without meaning it.
const SET_PHRASES =
  /\b(?:mourir|crever|me tuer|creve|meurs) (?:de (?:rire|chaud|faim|fatigue|froid|soif|honte|envie)|au (?:boulot|travail|taf|sport)|a la (?:salle|tache)|tellement)\b/gu;
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
  /\b(sexe|sexuel(le)?s?|sexy|faire l amour|coucher avec|couche avec|nue?s?|excitee?s?|envie de toi|caresser|au lit|fantasmes?|fantasmer|fantasme sur|joue[rsz]? (une?|la|le)|jeu de role|sex|sexual|make love|making love|naked|nude|horny|in bed|turned on|fantasy|fantasize|fantasise|roleplay|role play|fare l amore|nud[ao]|eccitat[oa]|ecciti|mi ecciti|excitas|me excitas|turn me on|tu m excites|a letto|sesso|fantasia|gioco di ruolo|hacer el amor|desnud[oa]|excitad[oa]|en la cama|sexo|fantasias?|juego de rol)\b/u;
// A length of time is no age: « marié depuis 15 ans », « 15 ans de mariage », « for 15 years », « hace 15 años ».
const AGE_NUMBER =
  '(?:1[0-7]|[1-9]|onze|douze|treize|quatorze|quinze|seize|dix sept|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)';
const AGE_UNIT = '(?:ans?|years?|anni|anos)';
const DURATION = new RegExp(
  `\\b(?:depuis|il y a|pendant|fait|for|since|da|desde|hace|durante|per) ${AGE_NUMBER} ?${AGE_UNIT}\\b|\\b${AGE_NUMBER} ?${AGE_UNIT} (?:de|d|que|qu|of|ago|fa|di|en)\\b`,
  'gu',
);

// A minor or an age under 18, as the object of a verb or a role (Sécurité, #1043): the word, with its article.
const MINOR_TERM =
  '(?:(?:une?|a|an|una?|uno|des|la|le|les|the|une petite|a una|a un) )?(?:enfants?|gamine?s?|gosses?|momes?|fillettes?|petites? filles?|petit garcon|mineure?s?|ados?|adolescente?s?|collegien(?:ne)?s?|lyceen(?:ne)?s?|ecolier(?:e)?s?|eleves?|jeunettes?|lolitas?|kids?|child(?:ren)?|teens?|teenagers?|minors?|schoolgirls?|little girls?|young girls?|ragazzin[aeio]|bambin[aeio]|scolarett[ae]|liceal[ei]|nin[ao]s?|jovencitas?|colegialas?|(?:fille|girl|ragazza|chica|garcon|boy|one|una|uno) (?:de |of |di )?(?:1[0-7]|[1-9])(?: ?(?:ans|years? old|yo|anni|anos))?|(?:1[0-7]|[1-9]) ?(?:ans|year old|years old|yo|anni|anos))';
// A sexual act or a desire carried onto him or her: « toucher », « baiser », « fantasmer sur » (fr/en/it/es).
const SEX_VERBS =
  '(?:te prendre|te prends|te prend|je te prends|baiser|baise|baises|baiserais|baiserai|niquer|nique|toucher|touche|tripoter|caresser|caresse|sucer|lecher|leche|deshabiller|coucher avec|couche avec|faire l amour (?:a|avec)|bander (?:sur|pour)|bande (?:sur|pour)|fantasme (?:sur|de)|fantasmer (?:sur|de)|fantasmes (?:sur|de)|mater|fuck|fucking|touch|touching|kiss|kissing|lick|licking|sleep with|have sex with|bang|fantasi[sz]e (?:about|on)|scopare|scopo|toccare|tocco|baciare|leccare|follar|follo|coger|tocar|toco|besar|lamer)';
// A wish, read only in a sexual message: « j'ai envie d'une … », « je veux une … ».
const DESIRE_VERBS =
  '(?:veux|voudrais|envie (?:de|d)|desire|reve (?:de|d)|want|wanna|would love|voglio|vorrei|desidero|quiero|querria|deseo)';
// A role he asks of her: « joue une écolière », « déguise-toi en … », « play a … », « disfrázate de … ».
const ROLE_VERBS =
  '(?:joue|jouer|joues|fais|faire|sois|deguise toi en|habille toi en|deguisee en|habillee en|be|play|pretend to be|act like|dress up as|dress as|roleplay|role play|interpreta|fai|fare|vestiti da|sii|haz|hacer|juega a ser|disfrazate de|vistete de)';
// Between the verb and the minor's word, only a few words that qualify it: the link never crosses another complement
// (« je l'ai prise pendant que les enfants dormaient »). Commas and stops split the message beforehand.
const BETWEEN = '(?: (?:vraiment|really|bien|encore|tres|so|very|cosi|tan|toute|jeune|jeunes|belle|vraie))*';
const SEX_ONTO_MINOR = new RegExp(`\\b${SEX_VERBS}\\b${BETWEEN} ${MINOR_TERM}\\b`, 'u');
const DESIRE_ONTO_MINOR = new RegExp(`\\b${DESIRE_VERBS}\\b${BETWEEN} ${MINOR_TERM}\\b`, 'u');
const MINOR_ROLE = new RegExp(
  `\\b${ROLE_VERBS}(?: (?:moi|me|pour moi|for me|per me|para mi|la|le))?(?: (?:une?|a|an|la|una?|uno))? ${MINOR_TERM}\\b`,
  'u',
);
// The minor's word first, then his desire: « tu ressembles à une ado ça m'excite », « les gamines ça m'excite ».
const MINOR_THEN_DESIRE = new RegExp(
  `${MINOR_TERM}(?: [\\p{L}']+){0,2}? (?:ca |that |questo |eso )?(?:m excite|m excitent|m excitait|me fait envie|me rend fou|turns? me on|mi eccita|mi eccitano|me excita|me excitan|me pone)\\b`,
  'u',
);
// Her, as a minor, in a fantasy of his: « toi en écolière », « te voir en lycéenne », « you as a schoolgirl ».
const HER_AS_MINOR = new RegExp(
  `\\b(?:toi|te voir|t imaginer|imagine toi|you|te|ti|tu) (?:habillee |deguisee |dressed |vestita |vestida )?(?:en|as|as a|da|de|come|como) ${MINOR_TERM}\\b`,
  'u',
);
// His own child as the object of a sexual verb, or of his desire: the one case where his children count.
const HIS_CHILD =
  '(?:ma|mon|my|mia|mio|mi|la mia|il mio) (?:fille|fils|petite fille|belle fille|daughter|son|stepdaughter|figlia|figlio|figliastra|hija|hijo|hijastra)';
const SEX_ONTO_HIS_CHILD = new RegExp(
  `\\b(?:${SEX_VERBS}|envie (?:de|d)|desire)\\b${BETWEEN} ${HIS_CHILD}\\b`,
  'u',
);
const DESIRE_ONTO_HIS_CHILD = new RegExp(`\\b${DESIRE_VERBS}\\b${BETWEEN} ${HIS_CHILD}\\b`, 'u');
// « T'as 16 ans ? », « you're 16 », « hai 16 anni », « tienes 16 años », said to her in a sexual message, or before
// a sexual verb (« imagine que t'as 14 ans et que je te prends »).
const HER_AGE_UNDER_18 = new RegExp(
  `\\b(?:t as|tu as|t es|tu es|you re|you are|hai|tienes) (?:que |only |solo |juste )?(?:1[0-7](?: ?${AGE_UNIT})?|${AGE_NUMBER} ?${AGE_UNIT})\\b`,
  'u',
);
const ANY_SEX_VERB = new RegExp(`\\b${SEX_VERBS}\\b`, 'u');
// What is never his fantasy: his own children (« mes gosses dorment », « je dépose mon fils »), a memory of his
// (« quand j'étais ado », « as a teen »).
const HIS_OWN_CHILDREN =
  /\b(?:mon|ma|mes|nos|notre|my|our|mio|mia|miei|mie|mi|mis|nuestros?|nuestras?) (?:fils|fille|filles|enfants?|gosses?|gamins?|gamines?|petits?|petites?|bebes?|ados?|kids?|children|sons?|daughters?|figli[oa]?|figlie|bambin[aeio]|hij[oa]s?|nin[ao]s?)\b|\b(?:j ai|j avais|i have|i ve got|i got|ho|tengo) (?:un |une |deux |trois |quatre |des |\d+ |a |two |three |due |tre |dos |tres )?(?:enfants?|gosses?|fils|filles?|kids?|children|sons?|daughters?|figli|figlie|hij[oa]s)\b/gu;
const HIS_MEMORY =
  /\b(?:quand j etais|quand j avais|lorsque j etais|a l epoque|as a (?:kid|teen|teenager|child|boy|young man)|when i was|back when|da ragazz[oa]|quando ero|cuando era|de petite?|de jeune|plus jeune)\b.*/gu;

/**
 * He puts a child or a minor in a sexual act (Sécurité, #1043): only on a direct link, read clause by clause so that
 * it crosses neither a comma nor another complement. A sexual verb, or in a sexual message a verb of desire, carried
 * onto a minor's word or an age under 18, or the other way round (« les gamines ça m'excite »); a minor's role he asks
 * of her, or her as a minor in his fantasy (« toi en écolière »); an age under 18 he gives her, in a sexual message or
 * before a sexual verb; his own child as the object of a sexual verb or of his desire. Otherwise never his own
 * children nor a memory of his, never procreation between adults. What code does not decide, the brain classes (in
 * doubt, a handoff).
 */
function minorFantasy(fanText: string): boolean {
  const whole = withoutProcreation(normaliseWords(fanText));
  const sexual = SEXUAL_WORDS.test(whole) || checkExplicit([fanText]).length > 0;
  const clauses = normalise(fanText)
    .split(/[,;:.!?\n]+|\s[-–—]\s/u)
    .map((clause) => withoutProcreation(normaliseWords(clause)).replace(DURATION, ' '));
  const ageGiven = clauses.some((clause) => HER_AGE_UNDER_18.test(clause.replace(HIS_MEMORY, ' ')));
  if (ageGiven && (sexual || ANY_SEX_VERB.test(whole))) return true;
  return clauses.some((clause) => {
    if (SEX_ONTO_HIS_CHILD.test(clause) || (sexual && DESIRE_ONTO_HIS_CHILD.test(clause))) return true;
    const his = clause.replace(HIS_OWN_CHILDREN, ' ').replace(HIS_MEMORY, ' ');
    if (SEX_ONTO_MINOR.test(his) || MINOR_ROLE.test(his) || MINOR_THEN_DESIRE.test(his)) return true;
    return sexual && (DESIRE_ONTO_MINOR.test(his) || HER_AS_MINOR.test(his));
  });
}

/**
 * The signs his own words carry, the gravest first; none when nothing is written plainly. A birth year is read
 * against `now`'s year.
 */
export function safetySigns(fanText: string, now: Date = new Date()): SafetySign[] {
  const text = normalise(fanText);
  const signs: SafetySign[] = [];
  const his = clausesOfHis(text);
  // A trade said in the same message cancels a school or a minor's word (Sécurité, #1043): « je suis au lycée, je
  // suis prof ». An age under 18 still counts.
  const atWork = HIS_TRADE.test(text);
  if (
    MINOR_AGE.some((pattern) => pattern.test(text)) ||
    (!atWork &&
      (MINOR_WORDS.some((pattern) => pattern.test(text)) ||
        his.some(
          (clause) =>
            MINOR_PLACES.some((pattern) => pattern.test(clause)) || bornMinor(clause, now.getUTCFullYear()),
        )))
  )
    signs.push('minor_suspected');
  if (minorFantasy(fanText)) signs.push('minor_fantasy');
  // Set phrases are no distress (Sécurité, #1043): « mourir de rire », « me tuer au boulot », « crever de chaud »,
  // « crever tellement t'es belle ». Everything else still alerts.
  if (SELF_HARM.some((pattern) => pattern.test(text.replace(SET_PHRASES, ' ')))) signs.push('self_harm');
  return signs;
}
