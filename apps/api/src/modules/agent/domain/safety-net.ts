import { isGuardedLanguage, normalise, type Language } from '@impera/contracts';

import { detectLanguage, isMostlyLatin } from './language';

/**
 * The safety net in code (recette AGT-01, Charles « ok filet sécurité », 06/11 18h41): what he wrote himself says he
 * is a minor, or that he wants to hurt himself, and a human answers him before any model reads it. The brain still
 * reads the risks it alone can see; this net only catches what is written plainly, so that a model's miss never
 * leaves the bot chatting with a minor or a fan in danger. A false alarm costs one handoff to a chatter.
 */
export type SafetySign = 'minor_suspected' | 'self_harm';

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
const UNIT = '(?:anni|anos|ans?|years?|yrs?|yo|y\\/o)\\b';
// Not his age: « di esperienza », « de casado », « of experience », « fa » (ago). « De edad », « di età », « of age »
// are.
const NOT_AGE_ANY = "di (?!eta)|d'|de (?!edad)|d |che |que |qu'|of (?!age)|since |ago\\b|fa\\b";
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
  /\b(?:je suis|j'?suis|chui) (?:encore )?mineure?\b/u,
  /\b(?:je suis|j'?suis|chui) (?:encore )?(?:au college|en (?:6|5|4|3)e?me\b|en (?:sixieme|cinquieme|quatrieme|troisieme)\b|en seconde\b(?!\s+(?:position|place|fois|main|zone|chance|partie)))/u,
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
  /\b(?:je suis|j'?suis|jsuis|chui) (?:encore )?(?:au lycee|en terminale\b(?!\s+(?:de |d'))|en premiere\b(?!\s+(?:position|place|fois|ligne|annee|classe|de |d')))/u,
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
  // ADR 0168 § 4: « né en », « nato nel », « sono del », « classe », « nacido en », « soy del », « born in ».
  const born =
    /\b(?:nee? en|nat[oa] nel|sono del|classe|nacid[oa] en|naci en|soy del|born in)\s*((?:19|20)\d\d)\b/u.exec(
      text,
    )?.[1];
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
  // ADR 0168 § 4: English, Italian, Spanish.
  /\b(?:end|take) my (?:own )?life\b|\b(?:hurt|cut) myself\b|\bdon'?t want to (?:live|be alive) anymore\b|\bsuicidal\b/u,
  /\b(?:suicidarmi|suicidio|uccidermi|ammazzarmi)\b|\b(?:voglio|vorrei) morire\b|\bfarla finita\b|\bnon ho piu voglia di vivere\b|\bfarmi del male\b|\btagliarmi le vene\b/u,
  /\b(?:suicidarme|suicidio|matarme)\b|\b(?:quiero|me quiero) morir(?:me)?\b|\bno quiero (?:seguir )?viv(?:ir|iendo)\b|\bquitarme la vida\b|\bacabar con (?:todo|mi vida)\b|\bhacerme dano\b|\bcortarme las venas\b/u,
];

/**
 * A number from 10 to 17 that is not a thing (ADR 0168 § 4): not an hour, a sum, a measure, a rank, a count of
 * objects, nor years of something else (« 15h », « 15 € », « 15 cm », « 15/20 », « 15 photos », « 16 anni di
 * esperienza »).
 */
const TEEN_NOT_A_THING =
  '\\b1[0-7]\\b' +
  '(?![.,:/\\-]?\\d)(?!\\s*(?:h\\b|h\\d|%|€|\\$|£|°|x\\b|e\\b|eme\\b|er\\b|th\\b|st\\b|' +
  '(?:min|mins|minut\\w*|sec\\w*|s|cm|mm|m|km|kg|g|l|ml|cl|euros?|eur|dollars?|usd|bucks|pounds?|zl\\w*|' +
  'reais|lei|kr|chf|hours?|heures?|ore|horas?|uhr|stunden?|godz\\w*|jours?|days?|giorni|dias|tage|fois|times|' +
  'volte|veces|mal|pages?|photos?|pics?|videos?|messages?|followers?|likes?)\\b))' +
  // Years of something else, not his age: « 16 anni di esperienza », « 15 años de casado ».
  `(?!\\s*${UNIT}\\s*(?:${NOT_AGE_ANY}))`;

/**
 * A bare number from 10 to 17 in a message whose language the guards do not read (ADR 0168 § 4, closed by default):
 * without a word of his language to say it is an age, it is one until a human says otherwise.
 */
const BARE_TEEN = new RegExp(
  '(?<![\\d.,:/+\\-x#€$£])' +
    '(?<!\\b(?:a|at|alle|alla|a las|las|um|vers|top|no|nr|n|num|numero|page|p|dans|in|tra|fra|en|entre|between|' +
    'after|apres|dopo|despues|until|avant|before)\\s)' +
    TEEN_NOT_A_THING,
  'u',
);

/** Not a count of people, pets or money after « j'ai » or « presque » (« j'ai 15 potes », « tengo 15 amigos », « yo 15 dolares »). */
const NOT_COUNTED =
  '(?!\\s*(?:amis?|potes?|copains?|copines?|chats?|chiens?|enfants?|gosses?|amici|figli|gatti|cani|amigos|hijos|' +
  'gatos|perros|friends|kids|cats|dogs|dolares|pesos|libras|sterline)\\b)';

/**
 * His age without its unit, read whatever his kept language (ADR 0168 § 4): after a first-person word of a covered
 * language (« j'ai 15 », « moi 16 », « ho 15 », « io 16 », « tengo 15 », « yo 16 »), a message that is only the
 * number, alone or with a question back (« 15 », « ok 16 », « 16 et toi », « 15 e tu », « 17 y tu », « 15 and you »),
 * or about to turn it (« bientôt 17 », « quasi 17 », « casi 17 », « almost 17 »). Not « j'ai 15 min », « j'ai 15
 * photos », « tengo 15 euros », « presque 15h ».
 */
const AGE_WITHOUT_UNIT = [
  new RegExp(`\\b(?:j'?ai|moi|ho|io|tengo|yo)\\s*:?\\s*${TEEN_NOT_A_THING}${NOT_COUNTED}`, 'u'),
  new RegExp(
    `^[\\s\\p{P}]*(?:(?:ok|oui|ouais|si|yes|yeah|yep|bah|euh|eh|ben)[\\s\\p{P}]*)?1[0-7]` +
      `(?:\\s*(?:ans?|anni|anos|years?|yo))?[\\s\\p{P}]*` +
      `(?:(?:et|e|y|and|&)\\s*(?:toi|tu|te|vous|you|u|usted)[\\s\\p{P}]*)?[\\s\\p{P}\\p{Extended_Pictographic}\\uFE0F]*$`,
    'u',
  ),
  new RegExp(`\\b(?:bientot|presque|quasi|casi|almost|nearly)\\s*${TEEN_NOT_A_THING}${NOT_COUNTED}`, 'u'),
];

/**
 * Whether a bare number of a minor is read as his age (ADR 0168 § 4): his message is in a language the guards do not
 * read (`'unknown'`, another script, a language outside the coverage), or it says nothing of its language and none
 * covered is kept for him. A short message of a fan whose kept language is covered (« je rentre le 15 », « mdr 12 »)
 * is read by the patterns of his language, never by this one. Nothing kept, or not known here: closed by default.
 */
function bareNumberIsAge(fanText: string, kept: Language | null): boolean {
  if (!isMostlyLatin(fanText)) return true;
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
  /** His kept language (ADR 0168 § 3); `null` when none is kept, or the caller does not know it. */
  kept: Language | null = null,
): SafetySign[] {
  const text = normalise(fanText);
  const signs: SafetySign[] = [];
  const his = clausesOfHis(text);
  if (
    [...MINOR_AGE, ...MINOR_WORDS, ...AGE_WITHOUT_UNIT].some((pattern) => pattern.test(text)) ||
    his.some(
      (clause) =>
        MINOR_PLACES.some((pattern) => pattern.test(clause)) || bornMinor(clause, now.getUTCFullYear()),
    ) ||
    (BARE_TEEN.test(text) && bareNumberIsAge(fanText, kept))
  )
    signs.push('minor_suspected');
  if (SELF_HARM.some((pattern) => pattern.test(text))) signs.push('self_harm');
  return signs;
}
