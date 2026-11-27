import { isGuardedLanguage, normalise, normaliseWords, type Language } from '@impera/contracts';

import { checkExplicit, withoutProcreation } from './guards';
import { bareTeenReading, detectLanguage, isMostlyLatin } from './language';
import { BARE_TEEN, HER_AGE_QUESTION, NOT_AGE_ANY, TEEN_NOT_A_THING, UNIT } from './teen-number';

/**
 * The safety net in code (recette AGT-01, Charles « ok filet sécurité », 06/11 18h41): what he wrote himself says he
 * is a minor, or that he wants to hurt himself, and a human answers him before any model reads it. The brain still
 * reads the risks it alone can see; this net only catches what is written plainly, so that a model's miss never
 * leaves the bot chatting with a minor or a fan in danger. A false alarm costs one handoff to a chatter. A fantasy of
 * his that puts a child or a minor in a sexual act (`minor_fantasy`, Charles 26/11 at 23:45) is read the same way and
 * has the same effect as a doubt on his age. Asked to be like his own child (`his_child_role`, Sécurité, #1054), a
 * human takes the conversation, without the age freeze.
 */
export type SafetySign = 'minor_suspected' | 'minor_fantasy' | 'his_child_role' | 'self_harm';

// An age under 18, in digits or in words: « 16 », « seize », « dix-sept ».
const UNDER_18 = '(?:1[0-7]|[1-9]|onze|douze|treize|quatorze|quinze|seize|dix(?:[ -]?sept)?)';
// The unit after it: « ans », « piges ». The slang ones (« balais », « berges ») only from ten: « 5 balais » are brooms.
const YEARS = '(?:ans?|yo|piges?)';
const TEENS = '(?:1[0-7]|onze|douze|treize|quatorze|quinze|seize|dix(?:[ -]?sept)?)';
const SLANG_YEARS = '(?:balais|berges|printemps)';
// Not his age: « 16 ans d'expérience », « dix ans que j'habite ici ».
const NOT_AGE = "(?!\\s*(?:d'|de |d |que |qu'))";
// ADR 0168 § 4, the covered languages: an age under 18 in digits (whatever the language), or in Italian, Spanish and
// English words; the words that lead to his own age; the units after it.
const ANY_UNDER_18 =
  '1[0-7]|[1-9]|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|once|doce|trece|catorce|quince|dieciseis|diecisiete|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen';
const ANY_TEENS =
  '1[0-7]|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|once|doce|trece|catorce|quince|dieciseis|diecisiete|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen';
const NOT_AGE_AFTER = `(?!\\s*(?:${NOT_AGE_ANY}))`;
// What a number is when it is not an age: an hour, a sum, a length.
const NOT_A_NUMBER_OF_YEARS =
  '(?!\\s*(?:h\\b|:|€|\\$|euros?\\b|eur\\b|dollars?\\b|minut|min\\b|km\\b|cm\\b|kg\\b|%))';
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
  // ADR 0168 § 4: the same in every language the guards cover. « ho 16 anni », « tengo 15 años » (the unit required:
  // « ho 2 figli » is not an age), « i am 16 », « età: 15 », « ne ho 16 », or the message opening on « 16 anni ». Not
  // « ho 16 anni di esperienza », « tengo 16 años de casado ».
  new RegExp(`\\b(?:ho|io ho|tengo|yo tengo)\\s*(?:${ANY_UNDER_18})\\s*${UNIT}\\b${NOT_AGE_AFTER}`, 'u'),
  new RegExp(
    `\\b(?:i am|i'?m|im|age|eta|edad)\\s*:?\\s*(?:${ANY_UNDER_18})\\b${NOT_A_NUMBER_OF_YEARS}(?!\\s*${UNIT}\\s*(?:${NOT_AGE_ANY}))`,
    'u',
  ),
  new RegExp(`\\bne ho\\s*(?:${ANY_TEENS})\\b${NOT_A_NUMBER_OF_YEARS}${NOT_AGE_AFTER}`, 'u'),
  new RegExp(`^\\s*(?:${ANY_UNDER_18})\\s*${UNIT}\\b${NOT_AGE_AFTER}`, 'u'),
  // He is about to turn 18, in Italian, Spanish or English: « sto per compiere 18 anni », « voy a cumplir 18 », « i'll
  // be 18 next month », « almost 18 ». Not « quasi 18 euro ».
  new RegExp(
    `\\b(?:sto per compiere|compio|faro|quasi|voy a cumplir|cumplo|casi|i'?ll be|i will be|gonna be|turning|almost|nearly)\\s*18\\b${NOT_A_NUMBER_OF_YEARS}(?!\\s*${UNIT}\\s*(?:${NOT_AGE_ANY}))`,
    'u',
  ),
];
// He says he is a minor, in so many words.
const MINOR_WORDS = [
  // « Mineur de fond » is a trade.
  /\b(?:je suis|j'?suis|chui) (?:encore )?mineure?\b(?! de fond| de charbon| dans)/u,
  /\b(?:je suis|j'?suis|chui) (?:encore )?(?:au college|en (?:6|5|4|3)e?me\b|en (?:sixieme|cinquieme|quatrieme|troisieme)\b|en seconde\b(?!\s+(?:position|place|fois|main|zone|chance|partie|equipe)))/u,
  /\bj(?:'| )?ai pas (?:encore )?18 ans\b/u,
  /\bpas encore majeure?\b/u,
  // ADR 0168 § 4: Italian, Spanish, English.
  /\b(?:sono|io sono|son) (?:ancora )?minorenne\b|\bnon ho (?:ancora )?(?:18|diciotto) anni\b|\bnon sono (?:ancora )?maggiorenne\b/u,
  /\b(?:soy|yo soy) (?:todavia |aun )?menor(?: de edad)?\b|\bno tengo (?:todavia |aun )?(?:18|dieciocho)(?: anos)?\b|\bno soy (?:todavia |aun )?mayor de edad\b/u,
  /\b(?:i'?m|i am|im) (?:still )?(?:a minor|underage|under 18|under eighteen)\b|\b(?:i'?m|i am|im) not (?:yet )?18\b/u,
];
// Where a minor is: middle school, a minor's class, a birth year. Read clause by clause, and not in a clause about
// his child or his pupils (« mon fils est en 4e », « je suis prof en 3e »).
const MINOR_PLACES = [
  // A minor's class or school, his own: « en 4e », « lycéen », « je suis au lycée ». Not a rank (« en 3e position »),
  // a year of study (« en 3e année ») or his past (« quand j'étais lycéen »).
  /(?<!etais |etait )\ben (?:6|5|4|3)e?(?:me)?\b(?!\s*(?:position|place|rang|vitesse|fois|ligne|annee|etage|div|semaine|jour|round|periode|mi-temps|de |d'))/u,
  /(?<!etais |etait |ancien |ancienne )\b(?:lyceen|lyceenne|collegien|collegienne)\b/u,
  /\b(?:je suis|j'?suis|jsuis|chui) (?:encore )?(?:au lycee|en terminale\b(?!\s+(?:de |d'|equipe))|en premiere\b(?!\s+(?:position|place|fois|ligne|annee|classe|equipe|de |d')))/u,
  // ADR 0168 § 4: a minor's school, his own, in Italian, Spanish, English. Not his past (« quando andavo alle medie »).
  /(?<!quando |andavo |ero )\b(?:vado|sono|faccio|frequento) (?:ancora )?(?:alle medie|in (?:prima|seconda|terza) media|la (?:prima|seconda|terza) media|al liceo|alle superiori)\b/u,
  /\b(?:voy|estoy|sigo) (?:todavia |aun )?(?:en|a) (?:la )?(?:secundaria|el instituto|el colegio|(?:primero|segundo|tercero|cuarto|1|2|3|4)(?:o|º)? (?:de )?(?:la )?eso)\b/u,
  /\b(?:i'?m|i am|im) (?:still )?in (?:middle school|high school|junior high|(?:6|7|8|9|10|11|sixth|seventh|eighth|ninth|tenth|eleventh)(?:th)? grade)\b/u,
];
const SOMEONE_ELSE =
  /\b(?:mon|ma|mes|son|sa|ses|notre|nos|un|une|le|la|les) (?:fils|fille|filles|gamin|gamine|gamins|enfant|enfants|neveu|niece|gosse|gosses|petit|petite|frere|soeur|ado|ados|eleve|eleves|boite|societe|entreprise)\b|\b(?:prof|professeur|professeure|enseignant|enseignante|j'?enseigne|surveillant|surveillante|cpe|instit|maitre|maitresse)\b/u;
// The same, in Italian, Spanish, English: « mio figlio », « mi hija », « my son », « i teach ».
const SOMEONE_ELSE_OTHERS =
  /\b(?:mio|mia|miei|mie|suo|sua|nostro|nostra) (?:figlio|figlia|figli|nipote|fratello|sorella|alunno|alunni|studenti)\b|\b(?:mi|mis|su|sus|nuestro|nuestra) (?:hijo|hija|hijos|hijas|sobrino|sobrina|hermano|hermana|alumno|alumnos|estudiantes)\b|\b(?:my|his|her|our) (?:son|daughter|kid|kids|child|children|nephew|niece|brother|sister|students?|pupils?)\b|\b(?:insegno|sono (?:un |una )?(?:prof|professore|professoressa|insegnante)|soy (?:profesor|profesora|maestro|maestra)|i teach|i'?m a teacher)\b/u;

/** A clause of his, about himself: his child's class or his pupils' are not his. */
function clausesOfHis(text: string): string[] {
  return text
    .split(/[.,;!?\n]+/u)
    .filter((clause) => !SOMEONE_ELSE.test(clause) && !SOMEONE_ELSE_OTHERS.test(clause));
}

/** Born in or after this year, he may be a minor: 18 years before this one, the doubt counting against him. */
function bornMinor(text: string, year: number): boolean {
  // In four languages (Sécurité, #1054; ADR 0168 § 4): « née en », « nato nel », « sono del », « classe », « nacido en »,
  // « soy del », « born in ».
  const born =
    /\b(?:nee? en|naci en|naci el ano|nacid[oa] en|sono nat[oa] nel|nat[oa] nel|sono del|classe|soy del|i was born in|born in)\s*((?:19|20)\d\d)\b/u.exec(
      text,
    )?.[1];
  return born !== undefined && Number(born) >= year - 18 && Number(born) <= year;
}
// A minor's class, said of himself now or soon, without « je suis » (Sécurité, #1043): « moi en première », « en
// terminale et toi ? », « je passe en terminale », « j'entre en seconde en septembre ». Not a year of study, a rank,
// a train class or a second-hand thing (« en première année de droit », « arrivé en première au marathon », « en
// seconde main »). « Seconde » and « première » alone count with a word of his (moi, je, cette année, et toi) or
// right after she asked what he does or his age.
const CLASS = '(?:(?:6|5|4|3)e?(?:me)?|sixieme|cinquieme|quatrieme|troisieme|seconde|premiere|terminale)';
const NOT_A_CLASS =
  "(?!\\s*(?:annee|annees|an\\b|classe|ligne|main|fois|place|position|rang|partie|equipe|vitesse|etage|div|zone|chance|round|periode|mi-temps|semaine|jour|de |d'|des |du ))";
const NOT_A_RANK =
  '(?<!arrivee? |fini |finie |termine |terminee |sorti |sortie |classee? |passee? la ligne |ranked )';
const CLASS_OF_HIS = new RegExp(
  `${NOT_A_RANK}\\ben (?:(?:6|5|4|3)e?(?:me)?|sixieme|cinquieme|quatrieme|troisieme|terminale)\\b${NOT_A_CLASS}|\\b(?:moi|je (?:passe|rentre|vais|serai|redouble|suis toujours|suis encore)|j'?(?:passe|rentre|entre|redouble)|je vais (?:passer|rentrer|entrer)|cette annee|l'?an prochain|a la rentree)\\b[^.!?]{0,20}\\ben ${CLASS}\\b${NOT_A_CLASS}|\\ben ${CLASS}\\b${NOT_A_CLASS}[^.!?]{0,25}\\b(?:cette annee|l'?an prochain|a la rentree|en septembre|et toi|toi\\b|aussi)`,
  'u',
);
// A short answer, « en première » or « seconde », after she asked what he does or his age.
const BARE_CLASS = new RegExp(`^\\s*(?:en )?${CLASS}\\b${NOT_A_CLASS}[^.!?]{0,15}[.!?]*\\s*$`, 'u');
const ASKS_WHAT_HE_DOES =
  /\b(?:tu fais quoi|tu fais koi|tu bosses|tu travailles|tu taffes|ton taf|ton metier|ton boulot|tu etudies|tes etudes|t'?es en quoi|tu es en quoi|quel age|t'?as quel age|tu as quel age|ton age|t'?es etudiant|tu es etudiant|tu fais des etudes|t'?es en quelle classe|en quelle classe)\b/u;
// He sits the brevet, a middle-school exam: « je passe le brevet ». The bac proves nothing.
const BREVET =
  /\b(?:je passe|j'?passe|je vais passer|je prepare|je revise|je revise pour|j'?ai) (?:le|mon) brevet\b(?! (?:de |d'|du |des (?!colleges)))/u;
// Not him now: a third person or a past time in the same sentence.
const NOT_HIM_NOW =
  /\b(?:il|elle|ils|elles|lui|eux) (?:est|sont|passe|passent|rentre|rentrent|entre|entrent|sera|seront|va|vont)\b|\bj'?(?:etais|avais|allais|faisais)\b|\b(?:je|tu|on) (?!vais|sais|fais|fait|sait|vait|plais|plait|connais|reconnais|tais|tait|mais|nait)[a-z]+(?:ais|ait)\b|\b(?:l'?an dernier|l'?annee derniere|a l'?epoque|quand j|il y a \d+ ans|y a \d+ ans)\b/u;

/** A minor's class or the brevet, his, now or soon: sentence by sentence, never a third person's or his past. */
function classOfHis(text: string, herLastTurn: string | undefined): boolean {
  const asked = herLastTurn !== undefined && ASKS_WHAT_HE_DOES.test(normalise(herLastTurn));
  return text
    .split(/[.!?\n]+/u)
    .some(
      (sentence) =>
        !NOT_HIM_NOW.test(sentence) &&
        clausesOfHis(sentence).some(
          (clause) =>
            CLASS_OF_HIS.test(clause) || BREVET.test(clause) || (asked && BARE_CLASS.test(clause.trim())),
        ),
    );
}
// His trade at a school or a minor's word that is a trade: « je suis prof », « je bosse au lycée », « surveillant ».
const HIS_TRADE =
  /\b(?:sono|soy|i'?m|i am)(?: (?:un|una|a|an|il|la|el))? (?:insegnante|professore|professoressa|maestra|maestro|docente|bidello|bidella|profesor|profesora|teacher|tutor|teaching assistant|school counselor|janitor)\b|\b(?:i (?:work|teach) (?:at|in)|lavoro (?:al|in un|in una|a)|insegno (?:al|in un|in una|a)|trabajo en (?:el|un|una)|enseno en (?:el|un|una)) (?:a |the )?(?:high school|middle school|school|liceo|scuola|instituto|colegio|escuela)\b|\b(?:je suis|j'?suis|jsuis|chui|je bosse|je travaille|je taffe)(?: (?:comme|en tant que))? (?:prof|professeur|professeure|enseignant|enseignante|surveillant|surveillante|cpe|proviseur|principal|principale|documentaliste|aed|instit|maitre|maitresse|agent|cuisinier|cuisiniere|infirmier|infirmiere|tuteur|tutrice)\b|\b(?:je bosse|je travaille|je taffe|j'?enseigne) (?:au|dans un|dans une|en) (?:lycee|college|ecole)\b/u;
// Set phrases that name death or harm without meaning it.
const SET_PHRASES =
  /\b(?:mourir|crever|me tuer|creve|meurs) (?:de (?:rire|chaud|faim|fatigue|froid|soif|honte|envie)|au (?:boulot|travail|taf|sport)|a la (?:salle|tache)|tellement)\b/gu;
/**
 * Not a thing he goes on with: « continuer la série », « continuare questo gioco », « seguir con el juego », « going on
 * with the show ». « continuer à vivre » is no thing: it stays read.
 */
const NOT_A_THING_AFTER =
  "(?!\\s+(?:la|le|les|l'|ce|cet|cette|ces|mon|ma|mes|ton|ta|tes|son|ses|notre|votre|leur|un|une|des|du|au|aux|" +
  'il|lo|gli|i|questo|questa|quel\\w*|el|los|las|este|esta|ese|esa|mi|su|the|this|that|my|your|an|with|' +
  'con (?!(?:la|mi) vida)|a (?!vivre|vivir|vivere|exister|avancer|respirer|me battre|tenir)\\w+)\\b)';

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
  // ADR 0168 § 4: English, Italian, Spanish.
  /\b(?:end|take) my (?:own )?life\b|\b(?:hurt|cut) myself\b|\bdon'?t want to (?:live|be alive) anymore\b|\bsuicidal\b/u,
  /\b(?:suicidarmi|suicidio|uccidermi|ammazzarmi)\b|\b(?:voglio|vorrei) morire\b|\bfarla finita\b|\bnon ho piu voglia di vivere\b|\bfarmi del male\b|\btagliarmi le vene\b/u,
  /\b(?:suicidarme|suicidio|matarme)\b|\b(?:quiero|me quiero) morir(?:me)?\b|\bno quiero (?:seguir )?viv(?:ir|iendo)\b|\bquitarme la vida\b|\bacabar con (?:todo|mi vida)\b|\bhacerme dano\b|\bcortarme las venas\b/u,
  // « À quoi ça sert de continuer », « à quoi bon continuer », « j'en peux plus de vivre », « envie de tout arrêter »
  // (eval pass 2, 26/11), and their cousins. Not « continuer la série », « continuer ce jeu »: a thing after it.
  new RegExp(
    `\\b(?:a quoi (?:bon|(?:ca|sa|c) (?:sert|sers)(?: de)?)|(?:ca|sa|c) (?:sert|sers) a ?rien(?: de)?|` +
      `(?:ca|sa) vaut (?:plus )?pas la peine de|plus la peine de) (?:continuer|vivre|exister|avancer)\\b${NOT_A_THING_AFTER}`,
    'u',
  ),
  /\b(?:j'?en peux (?:plus|pu|pas)|jpp|j'?en ai marre) de (?:vivre|la vie|exister|ma vie)\b/u,
  /\benvie de tout (?:arreter|lacher|abandonner|stopper)\b/u,
  // Italian, Spanish, English: « a che serve continuare », « para qué seguir », « what's the point of going on ».
  new RegExp(
    `\\b(?:a che (?:serve|pro)|che senso ha|non (?:ha|ha piu) senso|perche) (?:continuare|andare avanti|vivere|esistere)\\b` +
      `${NOT_A_THING_AFTER}|\\bnon ce la faccio piu a vivere\\b|\\bvoglio (?:mollare tutto|farla finita con tutto)\\b`,
    'u',
  ),
  new RegExp(
    `\\b(?:para que|de que sirve|que sentido tiene|no tiene sentido|ya no tiene sentido) (?:seguir|vivir|continuar|existir)\\b` +
      `${NOT_A_THING_AFTER}|\\bno puedo mas con (?:la|mi) vida\\b|\\bquiero (?:dejarlo todo|terminar con todo)\\b`,
    'u',
  ),
  new RegExp(
    `\\b(?:what'?s|whats|what is) the point (?:of|in) (?:going on|carrying on|continuing|living|being alive|existing)\\b` +
      `${NOT_A_THING_AFTER}|\\bno point (?:in |of )?(?:living|going on|carrying on|being alive)\\b` +
      `|\\b(?:want|wanna|going) to end it all\\b|\\bcan'?t go on (?:anymore|living|like this)\\b|\\btired of living\\b`,
    'u',
  ),
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

// A school costume between adults (Sécurité, #1043): « joue une lycéenne », « toi en écolière », « ta jupe d'écolière »
// raise nothing. Only a real minor does: « une vraie lycéenne », « une écolière de 15 ans », « lycéenne mineure ».
const COSTUME =
  '(?:collegien(?:ne)?s?|lyceen(?:ne)?s?|ecolier(?:e)?s?|eleves?|schoolgirls?|scolarett[ae]|liceal[ei]|colegialas?)';
const REAL_COSTUME = `(?:(?:vraie?s?|veritables?|real|vera|vere|verdaderas?) ${COSTUME}|${COSTUME} (?:mineure?s?|underage|minorenn[ei]|menor(?:es)?|de (?:1[0-7]|[1-9]) ?ans|(?:1[0-7]|[1-9]) ?(?:ans|yo|years? old|anni|anos)))`;
// A minor or an age under 18, as the object of a verb or a role (Sécurité, #1043): the word, with its article.
const MINOR_TERM = `(?:(?:une?|a|an|una?|uno|des|la|le|les|the|une petite|a una|a un) )?(?:${REAL_COSTUME}|enfants?|gamine?s?|gosses?|momes?|fillettes?|petites? filles?|petit garcon|mineure?s?|ados?|adolescente?s?|jeunettes?|lolitas?|kids?|child(?:ren)?|teens?|teenagers?|minors?|little girls?|young girls?|ragazzin[aeio]|bambin[aeio]|nin[ao]s?|jovencitas?|(?:fille|girl|ragazza|chica|garcon|boy|one|una|uno) (?:de |of |di )?(?:1[0-7]|[1-9])(?: ?(?:ans|years? old|yo|anni|anos))?|(?:1[0-7]|[1-9]) ?(?:ans|year old|years old|yo|anni|anos))`;
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
// A school role he asks of her, with no age (Sécurité, #1043): no alert, but she does not play it; a hint brings her
// back to the outfit (« joue une lycéenne », « toi en écolière »).
const SCHOOL_ROLE = new RegExp(
  `\\b(?:${ROLE_VERBS}(?: (?:moi|me|pour moi|for me|per me|para mi|la|le))?(?: (?:une?|a|an|la|una?|uno|l))?|(?:toi|te voir|t imaginer|imagine toi|you|te|ti|tu) (?:en|as|as a|da|de|come|como)(?: (?:une?|a|an|una?))?) ${COSTUME}\\b`,
  'u',
);

/** He asks her to play a pupil, with no age (Sécurité, #1043): she does not, she brings him back to the outfit. */
export function asksSchoolRole(fanText: string): boolean {
  return normalise(fanText)
    .split(/[,;:.!?\n]+/u)
    .some((clause) => SCHOOL_ROLE.test(normaliseWords(clause)));
}

// He wants a minor, in so many words, sexual message or not (Sécurité, #1054): « je veux une mineure », « I want a
// minor », « voglio una minorenne », « quiero una menor ».
const WANTS_A_MINOR = new RegExp(
  `\\b${DESIRE_VERBS}\\b${BETWEEN} (?:(?:une?|a|an|una?|uno|des|some) )?(?:mineure?s?(?! de fond)|minors?|underage(?: (?:girls?|boys?))?|minorenn[ei]|menor(?:es)?(?: de edad)?)\\b`,
  'u',
);
// An age under 18 in his words, a length of time aside: beside a pupil's role, a real minor (Sécurité, #1054).
const AN_AGE_UNDER_18 = new RegExp(`\\b${AGE_NUMBER} ?${AGE_UNIT}\\b`, 'u');

// A role or a costume, never « ma fille est lycéenne »: a verb of playing or dressing up, a piece of clothing.
const ROLE_CONTEXT =
  /\b(?:joue|jouer|joues|jouons|deguise|deguisee|deguiser|habille|habillee|jeu de role|roleplay|role play|play|pretend|dress|dressed|disfrazate|vistete|vestiti|interpreta|jupes?|jupettes?|uniformes?|tenues?|costumes?|deguisement|outfit|uniform|skirt|divisa|falda)\b/u;

/**
 * A pupil's role or costume beside an age under 18 or his own child (« joue la lycéenne, comme ma fille de 15 ans »):
 * no costume any more, a real minor, whatever the comma between them (Sécurité, #1054).
 */
function costumeOfAMinor(fanText: string): boolean {
  const words = withoutProcreation(normaliseWords(fanText));
  if (!new RegExp(`\\b${COSTUME}\\b`, 'u').test(words) || !ROLE_CONTEXT.test(words)) return false;
  return (
    AN_AGE_UNDER_18.test(words.replace(DURATION, ' ')) || new RegExp(`\\b${HIS_CHILD}\\b`, 'u').test(words)
  );
}

// His own child in an outfit he asks of her (Sécurité, #1054): « habille-toi comme ma fille ». A human takes over
// (`minor_suspected`); no fantasy is read in it.
/**
 * A request to her to be like his own child (Sécurité, #1054): an imperative, or « tu », with dressing up, playing,
 * doing or being, then « comme ma fille / mon fils » (« habille-toi comme ma fille », « tu te déguises comme mon
 * fils »). Not « ma fille s'habille comme toi », « t'es belle comme ma fille », « j'ai une fille de ton âge ». Read on
 * `normaliseWords`.
 */
const HIS_OWN_CHILD =
  '(?:ma|mon|my|mia|mio|la mia|il mio|mi) (?:fille|fils|daughter|son|figlia|figlio|hija|hijo)';
const LIKE_HIS_CHILD = new RegExp(
  '\\b(?:(?:habille|deguise|sape) toi|habillez vous|deguisez vous|joue|jouez|fais|faites|sois|soyez|' +
    'tu (?:t habilles|te deguises|te sapes|joues|fais|es|seras|serais)|' +
    'tu (?:veux|voudrais|peux|pourrais|vas|dois) (?:t habiller|te deguiser|jouer|faire|etre)|' +
    'dress(?: up)?|act|play|be|vestiti|travestiti|fai|sii|vistete|disfrazate|haz)' +
    '(?: (?:un peu|exactement|juste|just|exactly))? (?:comme|like|come|como) ' +
    `${HIS_OWN_CHILD}\\b`,
  'u',
);

/**
 * The direct forms of the same request, in French, English, Italian and Spanish (Sécurité, #1054): being his child
 * (« sois ma fille ce soir », « be my daughter », « sii mia figlia », « sé mi hija »), pretending (« fais comme si
 * t'étais ma fille », « pretend you're my daughter », « fai finta di essere mia figlia », « haz como si fueras mi
 * hija »), playing the role (« tu peux jouer ma fille ? », « play my daughter », « fare mia figlia », « hacer de mi
 * hija »), or wearing her clothes (« mets la robe de ma fille », « wear my daughter's dress », « mettiti il vestito
 * di mia figlia », « ponte el vestido de mi hija »). Never what he does himself (« je mets la robe de ma fille au
 * lavage »), nor « jouer avec ma fille ». Read on `normaliseWords`.
 */
const AS_HIS_CHILD = [
  new RegExp(
    `\\b(?:sois|soyez|tu seras|tu serais|be|sii|se|seas)(?: (?:juste|just|solo))? ${HIS_OWN_CHILD}\\b`,
    'u',
  ),
  new RegExp(
    `\\b(?:(?:fais|faites|faisons|on fait) comme si (?:t etais|tu etais|vous etiez|t es|tu es)|imagine (?:que )?(?:t es|tu es|t etais|tu etais)|` +
      `pretend (?:to be|you re|you are|youre)|fai finta di essere|immagina di essere|(?:haz|hagamos) como si (?:fueras|eres)|imagina que eres) ${HIS_OWN_CHILD}\\b`,
    'u',
  ),
  new RegExp(
    `\\b(?:joue|jouer|jouez|joues|play|interpreta|interpretare|fai|fare|haz|hacer|juega|jugar)(?: (?:a|the role of|il ruolo di|el papel de|de))? ${HIS_OWN_CHILD}\\b(?! s\\b)`,
    'u',
  ),
  new RegExp(
    `(?<!\\b(?:je|j|i|io|yo|me) )\\b(?:mets|metez|porte|portez|enfile|wear|put on|mettiti|metti|indossa|ponte|pon|usa)\\b[^,;.!?]{0,30}\\b(?:de|di|of|del|della|dello) ${HIS_OWN_CHILD}\\b`,
    'u',
  ),
  new RegExp(`(?<!\\b(?:i) )\\b(?:wear|put on)\\b[^,;.!?]{0,20}\\bmy (?:daughter|son) s\\b`, 'u'),
];

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
    if (
      SEX_ONTO_MINOR.test(his) ||
      MINOR_ROLE.test(his) ||
      MINOR_THEN_DESIRE.test(his) ||
      WANTS_A_MINOR.test(his)
    )
      return true;
    return sexual && (DESIRE_ONTO_MINOR.test(his) || HER_AS_MINOR.test(his));
  });
}

/** Not a count of people, pets or money after « j'ai » or « presque » (« j'ai 15 potes », « tengo 15 amigos », « yo 15 dolares »). */
const NOT_COUNTED =
  '(?!\\s*(?:amis?|potes?|copains?|copines?|chats?|chiens?|enfants?|gosses?|amici|figli|gatti|cani|amigos|hijos|' +
  'gatos|perros|friends|kids|cats|dogs|dolares|pesos|libras|sterline)\\b)';

/**
 * His age without its unit, read whatever his kept language (ADR 0168 § 4): after a first-person word of a covered
 * language (« j'ai 15 », « j'en ai 15 », « moi c'est 16 », « moi 16 », « ho 15 », « io 16 », « tengo 15 », « yo 16 »),
 * alone or with a question back (« io 16 e tu », « j'ai 15 et toi »), a message that is only the
 * number, alone or with a question back (« 15 », « ok 16 », « 16 et toi », « 15 e tu », « 17 y tu », « 15 and you »),
 * or about to turn it (« bientôt 17 », « quasi 17 », « casi 17 », « almost 17 »). Not « j'ai 15 min », « j'ai 15
 * photos », « tengo 15 euros », « presque 15h ».
 */
const AGE_WITHOUT_UNIT = [
  new RegExp(`\\b(?:j'?ai|moi|ho|io|tengo|yo)\\s*:?\\s*${TEEN_NOT_A_THING}${NOT_COUNTED}`, 'u'),
  // « j'en ai 15 », « moi c 16 », « moi c'est 16 (ans) ».
  new RegExp(`\\b(?:j'?en ai|moi c'?est|moi c)\\s*:?\\s*${TEEN_NOT_A_THING}${NOT_COUNTED}`, 'u'),
  // First person, the number, then a question back: « io 16 e tu », « j'ai 15 et toi », « yo 16 y tu ».
  new RegExp(
    `\\b(?:j'?ai|j'?en ai|moi c'?est|moi c|moi|ho|io|tengo|yo|i'?m|i am)\\s*:?\\s*1[0-7]` +
      `(?:\\s*(?:ans?|anni|anos|years?|yo))?[\\s,.!]*(?:et|e|y|and|&)\\s*(?:toi|tu|te|vous|you|u|usted)\\b`,
    'u',
  ),
  new RegExp(
    `^[\\s\\p{P}]*(?:(?:ok|oui|ouais|si|yes|yeah|yep|bah|euh|eh|ben)[\\s\\p{P}]*)?1[0-7]` +
      `(?:\\s*(?:ans?|anni|anos|years?|yo))?[\\s\\p{P}]*` +
      `(?:(?:et|e|y|and|&)\\s*(?:toi|tu|te|vous|you|u|usted)[\\s\\p{P}]*)?[\\s\\p{P}\\p{Extended_Pictographic}\\uFE0F]*$`,
    'u',
  ),
  new RegExp(`\\b(?:bientot|presque|quasi|casi|almost|nearly)\\s*${TEEN_NOT_A_THING}${NOT_COUNTED}`, 'u'),
];

/**
 * Whether a bare number of a minor is read as his age (ADR 0168 § 4). His kept language is covered: only when it is
 * alone in its sentence, answers her question about his age, or stands with a word of a language outside the coverage
 * (`bareTeenReading`, 27/11); among unknown words, a human reads it without the doubt (`humanOnly`). Otherwise, as
 * before: his message, or one of its sentences, is in a language the guards do not read (`'unknown'`, another script,
 * a language outside the coverage), or it says nothing of its language and none covered is kept for him. Nothing
 * kept, or not known here: closed by default.
 */
function bareNumberIsAge(fanText: string, kept: Language | null, herLastTurn: string | undefined): boolean {
  const asked = herLastTurn !== undefined && HER_AGE_QUESTION.test(normalise(herLastTurn));
  const reading = bareTeenReading(fanText, asked);
  if (kept !== null && isGuardedLanguage(kept)) return reading === 'age';
  if (reading === 'age' || !isMostlyLatin(fanText)) return true;
  const read = detectLanguage(fanText);
  if (read === 'unknown') return true;
  if (read === null) return kept === null || !isGuardedLanguage(kept);
  return !isGuardedLanguage(read);
}

/**
 * The signs his own words carry, the gravest first; none when nothing is written plainly. A birth year is read
 * against `now`'s year.
 */
export function safetySigns(
  fanText: string,
  now: Date = new Date(),
  /**
   * Her last turn before his message: a bare class after she asked what he does or his age (Sécurité, #1043), a bare
   * number after she asked his age (ADR 0168 § 4).
   */
  herLastTurn?: string,
  /** His kept language (ADR 0168 § 3); `null` when none is kept, or the caller does not know it. */
  kept: Language | null = null,
): SafetySign[] {
  const text = normalise(fanText);
  const signs: SafetySign[] = [];
  // A pupil's role he asks of her is about her costume, never his class (Sécurité, #1043).
  const hisOf = (sentence: string) =>
    clausesOfHis(sentence).filter((clause) => !SCHOOL_ROLE.test(normaliseWords(clause)));
  // A trade said in the same sentence cancels a school or a minor's word (Sécurité, #1043): « je suis au lycée, je
  // suis prof ». Never in another sentence of a long message, and never an age nor a birth year.
  const schoolWord = (sentence: string) =>
    !HIS_TRADE.test(sentence) &&
    (MINOR_WORDS.some((pattern) => pattern.test(sentence)) ||
      hisOf(sentence).some((clause) => MINOR_PLACES.some((pattern) => pattern.test(clause))) ||
      classOfHis(sentence, herLastTurn));
  if (
    [...MINOR_AGE, ...AGE_WITHOUT_UNIT].some((pattern) => pattern.test(text)) ||
    (BARE_TEEN.test(text) && bareNumberIsAge(fanText, kept, herLastTurn)) ||
    hisOf(text).some((clause) => bornMinor(clause, now.getUTCFullYear())) ||
    text.split(/[.!?\n]+/u).some(schoolWord)
  )
    signs.push('minor_suspected');
  const realMinorInRole = costumeOfAMinor(fanText);
  if (realMinorInRole && !signs.includes('minor_suspected')) signs.push('minor_suspected');
  if (realMinorInRole || minorFantasy(fanText)) signs.push('minor_fantasy');
  // Asked to be like his own child: a human reads it, without the age freeze (Sécurité, #1054).
  const words = normaliseWords(text);
  if (LIKE_HIS_CHILD.test(words) || AS_HIS_CHILD.some((pattern) => pattern.test(words)))
    signs.push('his_child_role');
  // Set phrases are no distress (Sécurité, #1043): « mourir de rire », « me tuer au boulot », « crever de chaud »,
  // « crever tellement t'es belle ». Everything else still alerts.
  if (SELF_HARM.some((pattern) => pattern.test(text.replace(SET_PHRASES, ' ')))) signs.push('self_harm');
  return signs;
}
