import { normalise, type FanFlags } from '@impera/contracts';

import type { GuardViolation } from './guards';
import { NO_SALE_RISKS } from './policy';

/**
 * A custom order (ADR 0090 § A): he asks for something made for him, outside her catalogue (a video for him, a call,
 * a voice note to him). She never sells it herself: the team does. Pure code, the brain only reads his intent.
 */
export interface CustomOrderContext {
  /** The brain read `asks_for_service` on his last message(s). */
  readonly asksForService: boolean;
  /** A chatter is on shift on her accounts now: the conversation goes to them. */
  readonly chatterOnShift: boolean;
  /** An order of his already waits for the team (a `custom_order_opened` with no takeover since). */
  readonly orderOpen: boolean;
  readonly risks: readonly string[];
  /**
   * His limits; unknown (the playground, a composer without them), she still commits to nothing but no order opens
   * and no chatter is called: nothing is promised to a fan who may be stopped.
   */
  readonly flags: FanFlags | undefined;
}

export type CustomOrderDecision =
  /** Not a custom order: the turn goes on as usual. */
  | { readonly kind: 'none' }
  /** A chatter takes the conversation now (cause `custom_order`), and the order opens. */
  | { readonly kind: 'handoff' }
  /** She answers from a brief set by code, committing to nothing; `opens`: the order waits for the team. */
  | { readonly kind: 'reply'; readonly brief: string; readonly opens: boolean };

/** Nobody on shift: she says she will see, with no yes, no no, no price and no delay. */
export const CUSTOM_ORDER_WAIT_BRIEF =
  'Il lui demande quelque chose fait pour lui, en dehors de ce qu’elle propose. Elle accueille sa demande avec chaleur et lui dit qu’elle va y réfléchir et revenir vers lui, sans dire oui ni non, sans aucun prix, sans aucun délai, sans rien promettre, puis elle reprend la conversation avec lui.';

/** His order already waits: she does not open it again, and still commits to nothing. */
export const CUSTOM_ORDER_OPEN_BRIEF =
  'Il revient sur sa demande faite pour lui, qu’elle a déjà notée. Elle lui dit avec légèreté qu’elle ne l’a pas oubliée, sans dire oui ni non, sans aucun prix, sans aucun délai, sans rien promettre, puis elle reprend la conversation avec lui.';

/** No sale at all for him now (a risk, sales frozen): she answers without taking the order. */
export const CUSTOM_ORDER_DECLINE_BRIEF =
  'Il lui demande quelque chose fait pour lui. Elle n’entre pas dans cette demande, avec douceur et sans reproche, sans rien promettre, sans parler de prix ni de contenu à acheter, et reprend la conversation avec lui.';

export function customOrderDecision(context: CustomOrderContext): CustomOrderDecision {
  if (!context.asksForService) return { kind: 'none' };
  const { flags } = context;
  if (
    flags?.doNotContact === true ||
    flags?.salesFrozen !== undefined ||
    context.risks.some((risk) => NO_SALE_RISKS.includes(risk))
  ) {
    return { kind: 'reply', brief: CUSTOM_ORDER_DECLINE_BRIEF, opens: false };
  }
  if (flags === undefined) return { kind: 'reply', brief: CUSTOM_ORDER_WAIT_BRIEF, opens: false };
  if (context.orderOpen) return { kind: 'reply', brief: CUSTOM_ORDER_OPEN_BRIEF, opens: false };
  if (context.chatterOnShift) return { kind: 'handoff' };
  return { kind: 'reply', brief: CUSTOM_ORDER_WAIT_BRIEF, opens: true };
}

// A yes to his order: « je te fais ça », « c'est d'accord », « ok je te la fais », « je peux te faire ça ».
const YES =
  /\b(oui|ok|okay|d'?accord|ca marche|pas de souci|pas de probleme|carrement|avec plaisir)\b.{0,30}\b(je (te |vous )?(la |le |les |l'|en )?(fais|ferai|fait|tourne|tournerai|envoie|enverrai|prepare|preparerai)|je peux (te |vous )?(la |le |les |l'|en )?(faire|tourner|envoyer|preparer))|\b(c'?est (d'accord|ok|bon|note pour toi)|marche conclu|deal)\b|\bje (te |vous )?(la |le |les |l')?(fais|ferai|tourne|tournerai|prepare|preparerai) (ca|cette|ce|ta|ton|tes|pour toi)\b|\bje peux (te |vous )?(la |le |les |l')?(faire|tourner|preparer) (ca|cette|ce|ta|ton|tes|pour toi)\b/;

// A delay: « demain », « ce soir », « dans 2 jours », « d'ici vendredi », « cette semaine ».
const DELAY =
  /\b(demain|apres-demain|ce soir|cette nuit|ce week-?end|cette semaine|la semaine prochaine|d'?ici (ce soir|demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|la fin|\d+|une|deux|trois|quelques)|dans (\d+|une|un|deux|trois|quelques|peu de) ?(minutes?|min|heures?|h|jours?|j|semaines?)|sous (\d+|une|un|deux|trois|quelques) ?(heures?|h|jours?|j|semaines?)|(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) (prochain|soir|matin))\b/;

// A price: a sum, or a sum's words (« pour 50 », « ça te coûtera », « tarif »).
const PRICE =
  /\d+([.,]\d{1,2})? ?(€|\$|(euros?|eur|balles|dollars?|usd)\b)|(€|\$) ?\d|\b(tarifs?|ca (te )?(coute|coutera|couterait)|prix (de|pour|special)|pour \d+)\b/;

/**
 * Her waiting answer to a custom order commits to nothing (ADR 0090 § A): no yes, no price, no delay. Blocking:
 * a human answers. Read only when that answer was asked of the voice, on each bubble and on the whole message.
 */
export function checkNoCommitment(bubbles: readonly string[]): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const found = (text: string) =>
    [YES, DELAY, PRICE].map((pattern) => pattern.exec(text)?.[0]).find((m) => m !== undefined);
  bubbles.forEach((bubble, bubbleIndex) => {
    const match = found(normalise(bubble));
    if (match !== undefined)
      violations.push({ code: 'no_commitment', severity: 'blocking', bubbleIndex, match });
  });
  if (violations.length === 0) {
    const match = found(normalise(bubbles.join(' ')));
    if (match !== undefined) violations.push({ code: 'no_commitment', severity: 'blocking', match });
  }
  return violations;
}
