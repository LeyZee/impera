import { normalise, type CustomFormat, type CustomOrderReading, type FanFlags } from '@impera/contracts';

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
  /** His age is confirmed now, by a human, by what he says or by his card: no order opens without it (M3). */
  readonly ageConfirmed?: boolean;
  /** He asks for something she never does (`never_do`): declined softly, never « je vais y réfléchir » (M3). */
  readonly neverDoes?: boolean;
  /**
   * His request already says what he wants (`saysWhatHeWants`): until then, with nobody on shift, she talks modalities
   * with him first and nothing is noted (Charles 27/11). A chatter on shift takes it as before and talks them himself.
   */
  readonly saysWhatHeWants: boolean;
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

/**
 * His request does not say yet what he wants (Charles 27/11): she checks he is serious by talking modalities, warmly,
 * before anything is noted. One light question, the kind he imagines or what he would like to see.
 */
export const CUSTOM_ORDER_ASK_BRIEF =
  'Il lui demande quelque chose fait pour lui, sans dire encore ce qu’il veut vraiment. Elle s’y intéresse avec chaleur et, pour voir s’il est sérieux, lui demande légèrement, comme une curiosité et jamais comme un formulaire, ce qu’il imagine : pour une cam, plutôt pour parler, habillée ou plus intime ; pour une vidéo, ce qu’il aimerait y voir. Sans dire oui ni non, sans aucun prix, sans aucun délai, sans rien promettre, puis elle reste avec lui dans la conversation.';

/** No sale at all for him now (a risk, sales frozen): she answers without taking the order. */
export const CUSTOM_ORDER_DECLINE_BRIEF =
  'Il lui demande quelque chose fait pour lui. Elle n’entre pas dans cette demande, avec douceur et sans reproche, sans rien promettre, sans parler de prix ni de contenu à acheter, et reprend la conversation avec lui.';

export function customOrderDecision(context: CustomOrderContext): CustomOrderDecision {
  if (!context.asksForService) return { kind: 'none' };
  const { flags } = context;
  if (
    flags?.doNotContact === true ||
    flags?.salesFrozen !== undefined ||
    context.risks.some((risk) => NO_SALE_RISKS.includes(risk)) ||
    context.neverDoes === true
  ) {
    return { kind: 'reply', brief: CUSTOM_ORDER_DECLINE_BRIEF, opens: false };
  }
  // Unknown limits, or his age not confirmed: she commits to nothing, and no order opens nor chatter is called.
  if (flags === undefined || context.ageConfirmed === false)
    return { kind: 'reply', brief: CUSTOM_ORDER_WAIT_BRIEF, opens: false };
  if (context.orderOpen) return { kind: 'reply', brief: CUSTOM_ORDER_OPEN_BRIEF, opens: false };
  // A chatter on shift takes it as before (ADR 0090 § A) and talks the modalities himself.
  if (context.chatterOnShift) return { kind: 'handoff' };
  // Modalities first (Charles 27/11): nothing is noted before he says what he wants.
  if (!context.saysWhatHeWants) return { kind: 'reply', brief: CUSTOM_ORDER_ASK_BRIEF, opens: false };
  return { kind: 'reply', brief: CUSTOM_ORDER_WAIT_BRIEF, opens: true };
}

/**
 * The formats where the kind alone does not say what he wants to see (Charles 27/11): a photo, a video, an intimate
 * cam. A call or a cam to talk says it by its kind; a reaction or a rating by the photo he sends.
 */
const WHAT_TO_SEE_FORMATS: readonly CustomFormat[] = ['photo', 'video', 'video_call_sexual'];

/**
 * Whether his request, as the brain read it into its boxes (`CustomOrderReading`), says what he wants: its kind
 * (`format`), and for a photo, a video or an intimate cam, at least one detail or supplement of his. Nothing read:
 * not yet.
 */
export function saysWhatHeWants(reading: CustomOrderReading | undefined): boolean {
  if (reading === undefined || reading.format === null) return false;
  if (!WHAT_TO_SEE_FORMATS.includes(reading.format)) return true;
  return Object.keys(reading.details).length > 0 || reading.supplements.length > 0;
}

/**
 * What stops a custom order before anything is asked (ADR 0159 § A.11), from the rules that come first: no sale for
 * him now (a risk, sales frozen, « Ne plus lui écrire »), something she never does, his limits unknown or his age not
 * confirmed. The same reading as `customOrderDecision`, for the turn of the custom-orders module.
 */
export type CustomOrderStopReason = 'none' | 'no_sale' | 'never_does' | 'hold';

export function customOrderStop(
  context: Pick<CustomOrderContext, 'risks' | 'flags' | 'ageConfirmed' | 'neverDoes'>,
): CustomOrderStopReason {
  const { flags } = context;
  if (
    flags?.doNotContact === true ||
    flags?.salesFrozen !== undefined ||
    context.risks.some((risk) => NO_SALE_RISKS.includes(risk))
  )
    return 'no_sale';
  if (context.neverDoes === true) return 'never_does';
  if (flags === undefined || context.ageConfirmed === false) return 'hold';
  return 'none';
}

// A yes to his order: « je te fais ça », « c'est d'accord », « ok je te la fais », « je peux te faire ça ».
const YES =
  /\b(oui|ok|okay|d'?accord|ca marche|pas de souci|pas de probleme|carrement|avec plaisir)\b.{0,30}\b(je (te |vous )?(la |le |les |l'|en )?(fais|ferai|fait|tourne|tournerai|envoie|enverrai|prepare|preparerai)|je peux (te |vous )?(la |le |les |l'|en )?(faire|tourner|envoyer|preparer))|\b(c'?est (d'accord|ok|bon|note pour toi)|marche conclu|deal)\b|\bje (te |vous )?(la |le |les |l')?(fais|ferai|tourne|tournerai|prepare|preparerai) (ca|cette|ce|ta|ton|tes|pour toi)\b|\bje peux (te |vous )?(la |le |les |l')?(faire|tourner|preparer) (ca|cette|ce|ta|ton|tes|pour toi)\b/;

// A promise to do it later, said without a yes (passe 2 du 26/11, conversation 31): « je te le ferai quand je pourrai,
// promis », « je vais te l'envoyer », « je te promets ». « Je te promets rien » commits to nothing.
const PROMISE =
  /\bje (te |t')(le |la |les |l'|l |en )?(ferai|enverrai|montrerai|tournerai|filmerai|prendrai|referai)\b|\bje vais (te |t')(le |la |les |l'|l |en )?(faire|envoyer|montrer|tourner|filmer)\b|\bpromis\b|\bje (te |t')(le |la )?promets?\b(?! (rien|pas))/;

// A delay: « demain », « ce soir », « dans 2 jours », « d'ici vendredi », « cette semaine ».
const DELAY =
  /\b(demain|apres-demain|ce soir|cette nuit|ce week-?end|cette semaine|la semaine prochaine|d'?ici (ce soir|demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|la fin|\d+|une|deux|trois|quelques)|dans (\d+|une|un|deux|trois|quelques|peu de) ?(minutes?|min|heures?|h|jours?|j|semaines?)|sous (\d+|une|un|deux|trois|quelques) ?(heures?|h|jours?|j|semaines?)|(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) (prochain|soir|matin))\b/;

// A tip asked (ADR 0159 § A.4): only ever the deposit of an order she said yes to, never on these answers.
const TIP = /\b(pourboires?|tips?)\b/;

// A price: a sum, or a sum's words (« pour 50 », « ça te coûtera », « tarif »).
const PRICE =
  /\d+([.,]\d{1,2})? ?(€|\$|(euros?|eur|balles|dollars?|usd)\b)|(€|\$) ?\d|\b(tarifs?|ca (te )?(coute|coutera|couterait)|prix (de|pour|special)|pour \d+)\b/;

/**
 * Her waiting answer to a custom order commits to nothing (ADR 0090 § A): no yes nor promise, no price, no delay, no tip asked
 * (ADR 0159 § A.4). Blocking: a human answers. Read only when that answer was asked of the voice, on each bubble and
 * on the whole message.
 */
export function checkNoCommitment(bubbles: readonly string[]): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const found = (text: string) =>
    [YES, PROMISE, DELAY, PRICE, TIP].map((pattern) => pattern.exec(text)?.[0]).find((m) => m !== undefined);
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
