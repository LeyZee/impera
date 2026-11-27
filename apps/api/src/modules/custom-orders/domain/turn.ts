import {
  CUSTOM_ORDER_QUESTIONS_MAX,
  ESSENTIAL_DETAILS,
  quoteCustomOrder,
  type CustomDetailKey,
  type CustomDetails,
  type CustomFormat,
  type CustomOrderReading,
  type CustomPriceGrid,
  type CustomQuote,
  type OpenCustomOrder,
} from '@impera/contracts';

/**
 * Her turn on a custom order (ADR 0159 § A.2, A.2 bis), before her yes: she understands the request playfully, one
 * light question at a time, never says yes, no, a price or a delay, and the card goes to her once it is complete (to
 * the owner after three questions without it). Pure code: the brain reads his words into boxes, this decides. Her
 * briefs name the box to ask for, never what he wrote: his words reach the prompt only in an untrusted block.
 */

/** @public What stops an order before anything is asked, read by the caller from the rules that come first (§ A.11). */
export type CustomOrderStop =
  /** Nothing stops it. */
  | 'none'
  /** No sale at all for him now: a risk, sales frozen, « Ne plus lui écrire ». She declines softly. */
  | 'no_sale'
  /** Something she never does (`never_do` of her sheet). She declines softly, without asking her. */
  | 'never_does'
  /** His limits unknown, or his age not confirmed: she commits to nothing, no order opens. */
  | 'hold';

export interface CustomOrderTurnInput {
  /** The brain read `asks_for_service` on his last message(s). */
  readonly asksForService: boolean;
  /** What the brain read of his order on this turn, supplements already checked against the list it was given. */
  readonly reading: CustomOrderReading | null;
  /** His order as it stands, or null when none is open. */
  readonly order: OpenCustomOrder | null;
  readonly stop: CustomOrderStop;
  /** A chatter is on shift on her accounts now: a new order goes to them, as before (ADR 0090). */
  readonly chatterOnShift: boolean;
  /** Her grid in force, or null when the owner never filled one in: the card then goes with no price. */
  readonly grid: CustomPriceGrid | null;
}

/** @public The voice guards a reply of this turn runs under, on top of every usual one. */
export type CustomOrderGuard =
  /** No yes, no price, no delay (ADR 0090 § A). */
  | 'no_commitment'
  /** No tip asked: a tip is asked only as the deposit of an order she said yes to (§ A.4). */
  | 'no_tip_request';

/** @public The card for her (§ A.2 bis): everything she needs to say yes or no, and the price her grid proposes. */
export interface CustomOrderCard {
  readonly format: CustomFormat | null;
  readonly supplements: readonly string[];
  readonly minutes: number | null;
  readonly details: CustomDetails;
  /** The grid's price, to accept or change; null without a format or a grid. Never told to the fan. */
  readonly quote: CustomQuote | null;
  /** To her when complete; to the owner when the details are still missing after the questions. */
  readonly to: 'creator' | 'owner';
  readonly missing: readonly (CustomDetailKey | 'format')[];
}

/** @public What the turn records for the conversation and the card queue. */
export type CustomOrderEvent =
  /** Her order is being gathered: what is known so far, and the question she asks now. */
  | { readonly type: 'custom_order_gathering'; readonly asked: CustomDetailKey | 'format' }
  /** The card is ready and goes to her (or the owner). */
  | { readonly type: 'custom_order_card_ready'; readonly card: CustomOrderCard }
  /** The order ends before her: she never does it, or no sale is possible for him now. */
  | { readonly type: 'custom_order_declined'; readonly by: 'grid' | 'never_does' | 'no_sale' };

export type CustomOrderTurn =
  /** Nothing about an order on this turn: the turn goes on as usual. */
  | { readonly kind: 'none' }
  /** A chatter takes the conversation now (cause `custom_order`); the order opens with what was read. */
  | { readonly kind: 'handoff'; readonly order: OpenCustomOrder }
  /** She answers from a brief set by code; `order` is his order after this turn (null: none open). */
  | {
      readonly kind: 'reply';
      readonly brief: string;
      readonly guards: readonly CustomOrderGuard[];
      readonly order: OpenCustomOrder | null;
      readonly event?: CustomOrderEvent;
    };

const GUARDS: readonly CustomOrderGuard[] = ['no_commitment', 'no_tip_request'];

/** Never yes, never no, never a price, never a delay, never another way to pay: said once, in every brief below. */
const NO_PROMISE =
  'sans dire oui ni non, sans aucun prix, sans aucun délai, sans rien promettre, et sans jamais parler d’un autre moyen de paiement que la plateforme';

/** She declines softly: no sale for him now, or something she never does. */
export const CUSTOM_ORDER_DECLINE_BRIEF =
  'Il lui demande quelque chose fait pour lui. Elle n’entre pas dans cette demande, avec douceur et sans reproche, sans rien promettre, sans parler de prix ni de contenu à acheter, et reprend la conversation avec lui.';

/** His limits unknown or his age not confirmed: she will see, nothing opens. */
export const CUSTOM_ORDER_HOLD_BRIEF = `Il lui demande quelque chose fait pour lui. Elle accueille sa demande avec chaleur et lui dit qu’elle va y réfléchir, ${NO_PROMISE}, puis elle reprend la conversation avec lui.`;

/** The card went to her: she keeps him warm while waiting (Charles, 20/11 15 h 53). */
export const CUSTOM_ORDER_WAIT_BRIEF = `Sa demande faite pour lui est notée et elle y réfléchit. Elle le garde près d’elle : complice, un peu taquine, elle lui laisse entendre que l’idée lui plaît, ${NO_PROMISE}, puis elle continue la conversation avec lui.`;

/** The light question per box: what she asks, never what he said. One at a time, playful, never a form. */
const ASK: Readonly<Record<CustomDetailKey | 'format', string>> = {
  format:
    'ce qu’il imagine exactement : une photo, une vidéo, sa réaction filmée, une note, un appel ou une visio',
  what: 'ce qu’il aimerait voir, précisément',
  when: 'pour quand il le voudrait',
  name_to_say: 'le prénom ou le mot qu’il aimerait qu’elle dise ou écrive',
  pose: 'la pose qu’il imagine',
  outfit: 'la tenue qu’il imagine',
  written_text: 'ce qu’il aimerait voir écrit sur elle',
  photo_count: 'combien de photos il imagine',
  duration: 'combien de temps il imagine',
  scenario: 'comment il imagine que ça se déroule',
  words: 'ce qu’il aimerait l’entendre dire',
  photo_received: 'la photo à laquelle il pense, s’il veut la lui montrer',
  tone: 'le ton qu’il aimerait : tendre, joueuse, sans filtre',
  availability: 'les moments où il est libre',
  // Never essential: asked once a cam is paid in full, never before (Charles, 26/11).
  instagram: 'son pseudo Instagram, pour qu’elle l’appelle',
};

const askBrief = (key: CustomDetailKey | 'format'): string =>
  `Il lui demande quelque chose fait pour lui. Elle s’y intéresse avec un plaisir joueur et, pour bien l’imaginer, lui demande une seule chose, légèrement, comme une curiosité et jamais comme un formulaire (${ASK[key]}), ${NO_PROMISE}.`;

/** His order with this turn's reading laid over it: a new value fills or replaces a box, nothing is erased. */
function mergeReading(order: OpenCustomOrder | null, reading: CustomOrderReading | null): OpenCustomOrder {
  const base: OpenCustomOrder = order ?? {
    state: 'gathering',
    format: null,
    supplements: [],
    minutes: null,
    details: {},
    questionsAsked: 0,
  };
  if (reading === null) return base;
  return {
    ...base,
    format: reading.format ?? base.format,
    supplements: [...new Set([...base.supplements, ...reading.supplements])],
    minutes: reading.minutes ?? base.minutes,
    details: { ...base.details, ...reading.details },
  };
}

/** The boxes still empty before the card can go: the format first, then its essential details, in order. */
export function missingDetails(order: OpenCustomOrder): readonly (CustomDetailKey | 'format')[] {
  if (order.format === null) return ['format'];
  return ESSENTIAL_DETAILS[order.format].filter(
    (key) => order.details[key] === undefined && !(key === 'duration' && order.minutes !== null),
  );
}

const quoteOf = (order: OpenCustomOrder, grid: CustomPriceGrid | null): CustomQuote | null =>
  order.format === null || grid === null
    ? null
    : quoteCustomOrder(grid, {
        format: order.format,
        supplements: order.supplements,
        ...(order.minutes === null ? {} : { minutes: order.minutes }),
      });

/** Whether this turn speaks of an order still before her yes: `gathering` or `awaiting_creator`. */
const beforeHerYes = (order: OpenCustomOrder | null): boolean =>
  order !== null && (order.state === 'gathering' || order.state === 'awaiting_creator');

export function customOrderTurn(input: CustomOrderTurnInput): CustomOrderTurn {
  const { order } = input;
  // An order past her answer is the next lots' (price, deposit, delivery): not this turn's.
  if (order !== null && !beforeHerYes(order)) return { kind: 'none' };
  // Nothing asked, nothing open: not an order. An open order with nothing read on this turn: he speaks of something
  // else, the conversation goes on as usual and the order keeps waiting.
  if (order === null && !input.asksForService) return { kind: 'none' };
  if (order !== null && input.reading === null && !input.asksForService) return { kind: 'none' };

  if (input.stop === 'no_sale' || input.stop === 'never_does')
    return {
      kind: 'reply',
      brief: CUSTOM_ORDER_DECLINE_BRIEF,
      guards: GUARDS,
      order: null,
      event: { type: 'custom_order_declined', by: input.stop },
    };
  if (input.stop === 'hold') return { kind: 'reply', brief: CUSTOM_ORDER_HOLD_BRIEF, guards: GUARDS, order };

  const merged = mergeReading(order, input.reading);
  if (order === null && input.chatterOnShift) return { kind: 'handoff', order: merged };

  // Her answer given in advance (« Elle le fait » off in her grid): declined without asking her (§ A.2).
  const quote = quoteOf(merged, input.grid);
  if (quote?.kind === 'declined')
    return {
      kind: 'reply',
      brief: CUSTOM_ORDER_DECLINE_BRIEF,
      guards: GUARDS,
      order: null,
      event: { type: 'custom_order_declined', by: 'grid' },
    };

  if (merged.state === 'awaiting_creator')
    return { kind: 'reply', brief: CUSTOM_ORDER_WAIT_BRIEF, guards: GUARDS, order: merged };

  const missing = missingDetails(merged);
  const [next] = missing;
  if (next !== undefined && merged.questionsAsked < CUSTOM_ORDER_QUESTIONS_MAX) {
    const asked = { ...merged, questionsAsked: merged.questionsAsked + 1 };
    return {
      kind: 'reply',
      brief: askBrief(next),
      guards: GUARDS,
      order: asked,
      event: { type: 'custom_order_gathering', asked: next },
    };
  }
  const card: CustomOrderCard = {
    format: merged.format,
    supplements: merged.supplements,
    minutes: merged.minutes,
    details: merged.details,
    quote,
    to: missing.length === 0 ? 'creator' : 'owner',
    missing,
  };
  return {
    kind: 'reply',
    brief: CUSTOM_ORDER_WAIT_BRIEF,
    guards: GUARDS,
    order: { ...merged, state: 'awaiting_creator' },
    event: { type: 'custom_order_card_ready', card },
  };
}
