import {
  HELP_LINES,
  isGuardedLanguage,
  normalise,
  type GuardedLanguage,
  type HelpLine,
  type Language,
} from '@impera/contracts';

import { SUGGESTIVE_EMOJIS } from './desire';
import type { GuardViolation } from './guards';
import { detectLanguage } from './language';

/**
 * The care mode (ADR 0088): a fan in distress, who speaks of hurting himself or tells of a real abuse, is answered by
 * the agent with care, nothing sold and nothing explicit, a human validating every word. What the voice is asked to
 * write is set here by code, never by the brain; what it must never write is refused by `checkCare`.
 */

/** What the voice writes in the care mode (ADR 0088 § 3): listening, in her voice, without selling or seducing. */
export const CARE_BRIEF =
  'Il ne va pas bien. Elle lui répond avec douceur et chaleur, en restant elle-même : elle l’écoute, reprend ce qu’il a dit, lui dit qu’elle est là pour lui et l’invite à en parler à quelqu’un de proche. Court, sans séduction ni sous-entendu, sans promesse, sans conseil médical, sans rien proposer, sans parler de prix, de contenu, de photo ni de rendez-vous.';

/** How the voice writes in the care mode, beside the brief. */
export const CARE_TONE_HINTS: readonly string[] = [
  'douce et simple, aucune allusion sexuelle',
  'court, une ou deux bulles',
];

/**
 * What a care answer never carries, read on the normalised text (no accents, lower case). Short and tested: « je
 * t'embrasse », « câlin », « je pense fort à toi » stay allowed (ADR 0088 § 3).
 */
const CARE_FORBIDDEN: readonly RegExp[] = [
  // A price or money.
  /\d\s*(?:€|e\b|eur\b|euros?\b|\$|dollars?\b)/u,
  /\b(?:prix|tarif|euros?|payer|paye|payant|achete|acheter|ppv|debloque|debloquer|abonnement|tip|pourboire)\b/u,
  // A link.
  /\bhttps?:\/\/|\bwww\.|\b[\w-]+\.(?:com|fr|me|net|io|link)\b/u,
  // A media or a script.
  /\b(?:photos?|videos?|vocal|contenu|exclu|exclusif|exclusive|nudes?|privee?s?)\b/u,
  // A meeting.
  /\b(?:rendez-vous|rdv|se voir|qu'on se voie|on se voit|se rencontrer|on se retrouve|venir chez|chez moi|chez toi)\b/u,
  // A sexual word.
  // Seduction without a sexual word (recette AGR-08): « je suis toute à toi ce soir », a giggle, a moan.
  /\b(?:toute? a toi|rien qu'a toi|tu me rends (?:folle|fou)|hihi+|hehe+|mm+h+)\b/u,
  // ADR 0168 § 4: English, Italian, Spanish.
  /\b(?:price|pay|paid|buy|unlock|tips?|prezzo|pagare|pagami|comprare|sblocca|mancia|precio|pagar|pagame|comprar|desbloquea|propina)\b/u,
  /\b(?:pics?|pictures?|video|content|foto|contenuto|contenido|esclusiv[oa]|exclusiv[oa])\b/u,
  /\b(?:meet|meet up|see each other|come over|vederci|incontrarci|ci vediamo|vernos|nos vemos)\b/u,
  /\b(?:sexy|horny|naked|nudes?|cock|dick|pussy|all yours|eccitat\w*|nuda|nudo|cazzo|figa|tutta tua|caliente|cachond\w*|desnud\w*|polla|toda tuya)\b/u,
  /\b(?:sexe|sexy|sexuel\w*|bite|queue|chatte|seins?|nichons?|cul|fesses|sucer|suce|baiser|baise|jouir|orgasme|excite\w*|bander|bande dur|branle\w*|mouille\w*|coquin\w*|lingerie|nue?s?|a poil|chaud(?:e|es)? pour|envie de toi)\b/u,
];

/**
 * The guard of the care mode (ADR 0088 § 3): a care answer that sells, meets or goes sexual stops, whoever wrote it,
 * the voice or a human retouching it. None, it may go to a human for validation.
 */
export function checkCare(bubbles: readonly string[]): GuardViolation[] {
  const violations: GuardViolation[] = [];
  bubbles.forEach((bubble, bubbleIndex) => {
    const text = normalise(bubble);
    for (const pattern of CARE_FORBIDDEN) {
      const match = pattern.exec(text);
      if (match !== null)
        violations.push({ code: 'care_breach', severity: 'blocking', bubbleIndex, match: match[0] });
    }
    // A wink, a flame, a devil: the emojis that read as desire (`desire.ts`), on the bubble as written.
    const emoji = SUGGESTIVE_EMOJIS.find((e) => bubble.includes(e));
    if (emoji !== undefined)
      violations.push({ code: 'care_breach', severity: 'blocking', bubbleIndex, match: emoji });
  });
  return violations;
}

/** The language of the help bubble (ADR 0168 § 5): one of the languages the guards cover, one bubble each. */
export type HelpLanguage = GuardedLanguage;

/**
 * The language of the help bubble: the one his words are in when code reads it and the guards cover it; else his kept
 * language when covered; else French when his words say nothing (Reveal's public), English when they are in another
 * language.
 */
export function helpLanguageOf(fanText: string, kept: Language | null = null): HelpLanguage {
  const read = detectLanguage(fanText);
  if (read !== null && read !== 'unknown' && isGuardedLanguage(read)) return read;
  if (kept !== null && isGuardedLanguage(kept)) return kept;
  return read === null ? 'french' : 'english';
}

/**
 * The help bubble of each language, written here in her casual voice, never by a model (wording approved by Charles,
 * 26/11): one bubble, tutoiement, no emoji. None names a number: each sends him to someone close or his country's
 * emergency number, since no number is ever picked by his language, French included (Charles, 26/11).
 */
const HELP_BUBBLES: Readonly<Record<HelpLanguage, string>> = {
  french:
    'et promets-moi un truc : si ça redevient trop lourd la nuit, parles-en à quelqu’un de proche ou appelle le numéro d’urgence de ton pays. je préfère te savoir pas tout seul',
  english:
    'and promise me something: if it gets too heavy again at night, talk to someone close to you or call your country’s emergency number. i’d rather know you’re not alone',
  italian:
    'e promettimi una cosa: se di notte torna a essere troppo pesante, parlane con qualcuno di vicino o chiama il numero di emergenza del tuo paese. preferisco saperti non da solo',
  spanish:
    'y prométeme una cosa: si por la noche vuelve a pesarte demasiado, habla con alguien cercano o llama al número de emergencias de tu país. prefiero saber que no estás solo',
};

/** The bubble that names his country's line, in the same voice: the number and what it is, posed by code. */
const NATIONAL_BUBBLES: Readonly<Record<HelpLanguage, (line: HelpLine) => string>> = {
  french: (line) =>
    `et promets-moi un truc : si ça redevient trop lourd la nuit, appelle le ${line.number} (${line.label}). quelqu’un t’écoute vraiment. je préfère te savoir pas tout seul`,
  english: (line) =>
    `and promise me something: if it gets too heavy again at night, call ${line.number} (${line.label}). someone will really listen. i’d rather know you’re not alone`,
  italian: (line) =>
    `e promettimi una cosa: se di notte torna a essere troppo pesante, chiama il ${line.number} (${line.label}). qualcuno ti ascolta davvero. preferisco saperti non da solo`,
  spanish: (line) =>
    `y prométeme una cosa: si por la noche vuelve a pesarte demasiado, llama al ${line.number} (${line.label}). alguien te escucha de verdad. prefiero saber que no estás solo`,
};

/**
 * The fixed bubble that closes the first care answer to dark thoughts, once per episode (ADR 0088 § 4): written here,
 * never by a model. A national number only when his country is a confirmed fact of his card and the table has a row
 * a person verified for it (ADR 0168 § 8, `HELP_LINES`); never a number picked by his language. Otherwise, in every
 * language, French included, it sends him to someone close or his country's emergency number.
 */
export function helpBubble(
  language: HelpLanguage,
  confirmedCountry: string | null = null,
  lines: readonly HelpLine[] = HELP_LINES,
): string {
  const line =
    confirmedCountry === null ? undefined : lines.find((each) => each.country === confirmedCountry);
  return line === undefined ? HELP_BUBBLES[language] : NATIONAL_BUBBLES[language](line);
}
