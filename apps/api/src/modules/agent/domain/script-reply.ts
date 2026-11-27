import { normalise } from '@impera/contracts';

/**
 * What his message does with the paid step waiting, when the brain said nothing of it (passe 3 du 27/11, conversation
 * 42). The brain reads it first (`Brief.scriptReply`); code only completes a reading it left empty: a price objection
 * is an answer to the step (he hesitates, it still waits), and a plain no to taking it is a refusal (ADR 0156 § 2,
 * `refusalMove`). French, English, Spanish and Italian.
 */
export type ScriptReply = 'refused' | 'answers_step' | 'claims_bought';

// « je vais pas la prendre », « je la prends pas », « non merci », « je passe », « I'll pass », « no la compro ».
const REFUSES_STEP =
  /\b(je (ne )?(vais|veux|peux) (pas|plus) (la |le |les |l'|en )?(prendre|acheter|payer|ouvrir|debloquer)|je (ne )?(la |le |les |l'|l |en )(prends|achete|paye|paie|ouvre|debloque|prendrai|acheterai) (pas|plus)|non merci|je passe( mon tour)?|sans moi|i'?ll pass|no thanks|i'?m not (buying|taking|paying for|getting) (it|that|this)|i (won'?t|will not|don'?t want to) (buy|take|pay for|get) (it|that|this)|no (la |lo )?(voy a )?(comprar|compro|pagar|pago|tomar|tomo)|paso\b|no gracias|non (la |lo )?(prendo|compro|pago)|passo\b|no grazie)\b/;

/** His message says no to taking the step waiting, plainly. */
export function refusesStep(fanText: string): boolean {
  return REFUSES_STEP.test(normalise(fanText));
}

/** The brain's reading of his reply to the step, completed by code where it left it empty. */
export function scriptReplyOf(
  brief: { readonly intent: string; readonly scriptReply?: ScriptReply | undefined } | undefined,
  fanText: string,
): ScriptReply | null {
  if (brief === undefined) return null;
  if (brief.scriptReply !== undefined) return brief.scriptReply;
  if (refusesStep(fanText)) return 'refused';
  return brief.intent === 'price_objection' ? 'answers_step' : null;
}
