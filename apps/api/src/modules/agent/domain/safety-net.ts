import { normalise } from '@impera/contracts';

/**
 * The safety net in code (recette AGT-01, Charles « ok filet sécurité », 06/11 18h41): what he wrote himself says he
 * is a minor, or that he wants to hurt himself, and a human answers him before any model reads it. The brain still
 * reads the risks it alone can see; this net only catches what is written plainly, so that a model's miss never
 * leaves the bot chatting with a minor or a fan in danger. A false alarm costs one handoff to a chatter.
 */
export type SafetySign = 'minor_suspected' | 'self_harm';

// He gives his own age under 18: « j'ai 16 ans », « moi 15 ans », « 16 ans et toi ? » at the start, « i'm 16 ».
// « J'ai 16 ans d'expérience » and « ma fille a 16 ans » are not his age.
const MINOR_AGE = [
  /\b(?:j(?:'| )?ai|moi|je suis age de|je suis agee de|age ?:?)\s*(?:1[0-7]|[1-9])\s*(?:ans?|yo)\b(?!\s*(?:d'|de |d ))/u,
  /^\s*(?:1[0-7]|[1-9])\s*(?:ans?|yo)\b(?!\s*(?:d'|de |d ))/u,
  /\bi'?m\s*(?:1[0-7]|[1-9])\b(?!\s*(?:years? of|yrs? of|h|:))/u,
  /\b(?:1[0-7]|[1-9])\s*(?:yo|y\/o|years? old)\b/u,
];
// He says where a minor is: middle school, a minor's class, or the word itself.
const MINOR_WORDS = [
  /\b(?:je suis|j'?suis|chui) (?:encore )?mineure?\b/u,
  /\b(?:je suis|j'?suis|chui) (?:encore )?(?:au college|en (?:6|5|4|3)e?me\b|en (?:sixieme|cinquieme|quatrieme|troisieme)\b|en seconde\b(?!\s+(?:position|place|fois|main|zone|chance|partie)))/u,
  /\bj(?:'| )?ai pas (?:encore )?18 ans\b/u,
  /\bpas encore majeure?\b/u,
];
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
];

/** The signs his own words carry, the gravest first; none when nothing is written plainly. */
export function safetySigns(fanText: string): SafetySign[] {
  const text = normalise(fanText);
  const signs: SafetySign[] = [];
  if ([...MINOR_AGE, ...MINOR_WORDS].some((pattern) => pattern.test(text))) signs.push('minor_suspected');
  if (SELF_HARM.some((pattern) => pattern.test(text))) signs.push('self_harm');
  return signs;
}
