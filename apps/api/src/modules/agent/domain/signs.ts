import { normalise, type FanSign } from '@impera/contracts';

import { discountAsked } from './objections';

/**
 * The signs of a tiresome time-waster read in his turn (ADR 0135, Charles 27/11), only once he is one: from the
 * brain's closed reading and his own words, never guessed. Counted by `conversations` over 14 days.
 */
export interface SignFacts {
  readonly intent: string;
  readonly occasion?: string | undefined;
  readonly risks: readonly string[];
  readonly fanText: string;
}

/** « Je te le prends demain », « quand je suis payé », « I'll buy it tomorrow »: a purchase put off. */
const PURCHASE_PROMISE =
  /\b(?:(?:je (?:te |t'|le |la |les |l')(?:le |la |les )?(?:prends|prendrai|achete|acheterai|paie|paierai|debloque|debloquerai)|je (?:prends|prendrai|achete|acheterai|debloque|debloquerai) (?:ca|tout|ton|ta|tes|le pack|la video))\b.{0,30}\b(?:demain|plus tard|ce soir|ce week-end|apres|bientot|la semaine prochaine)|quand (?:je (?:serai|suis) paye|j'aurai (?:ma paye|mon salaire|des sous|de l'argent))|(?:i'?ll|i will) (?:buy|get|unlock|pay)\b.{0,30}\b(?:tomorrow|later|tonight|soon|next week)|when i get paid|(?:te lo|lo) (?:compro|prendo)\b.{0,20}\b(?:domani|dopo|piu tardi|manana|luego))/u;

/** « Désolé », « pardon », « je m'excuse », « sorry », « scusa », « lo siento ». */
const APOLOGY =
  /\b(?:desole|pardon|je m'excuse|excuse[- ]moi|sorry|i apologi[sz]e|my bad|scusa(?:mi)?|mi dispiace|perdon|lo siento)\b/u;

export function fanSignsOf(facts: SignFacts): FanSign[] {
  const text = normalise(facts.fanText);
  const signs = new Set<FanSign>();
  if (facts.occasion === 'asks_proof') signs.add('proof_again');
  if (facts.intent === 'price_objection' || discountAsked(facts.intent, facts.fanText)) signs.add('haggles');
  if (facts.intent === 'asks_for_media') signs.add('free_after_refusal');
  if (facts.risks.includes('insult') || facts.risks.includes('harassment')) signs.add('pressure');
  if (facts.intent === 'asks_to_meet' || facts.intent === 'asks_personal_contact')
    signs.add('contact_insistence');
  if (PURCHASE_PROMISE.test(text)) signs.add('purchase_promise');
  if (APOLOGY.test(text)) signs.add('apologised');
  return [...signs];
}
