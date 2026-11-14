import { normalise } from '@impera/contracts';

import type { GuardViolation } from './guards';

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
  });
  return violations;
}

/** The language of the help bubble: only French has its number; any other gets the fixed sentence. */
export type HelpLanguage = 'fr' | 'other';

// A few words only English writes; a fan who writes none of them is read as French, Reveal's public.
const ENGLISH_WORDS =
  /\b(?:i|i'm|im|my|me|you|your|the|and|want|feel|don't|dont|can't|cant|life|anymore|myself|die|kill|alone)\b/gu;

/** The language his own words are in, for the help bubble: English when they read mostly so, French otherwise. */
export function helpLanguageOf(fanText: string): HelpLanguage {
  const text = normalise(fanText);
  const words = text.split(/\s+/u).filter((w) => w !== '');
  if (words.length === 0) return 'fr';
  const english = text.match(ENGLISH_WORDS)?.length ?? 0;
  return english * 3 >= words.length ? 'other' : 'fr';
}

/**
 * The fixed bubble that closes the first care answer to dark thoughts, once per episode (ADR 0088 § 4): written here,
 * never by a model. In French it gives the 3114, France's national suicide prevention line; otherwise it points him to
 * someone close or his country's emergency number.
 */
export function helpBubble(language: HelpLanguage): string {
  return language === 'fr'
    ? 'Et si les idées noires reviennent, tu peux appeler le 3114, jour et nuit, c’est gratuit et quelqu’un t’écoutera vraiment.'
    : 'And if the dark thoughts come back, please talk to someone close to you, or call your country’s emergency number.';
}
