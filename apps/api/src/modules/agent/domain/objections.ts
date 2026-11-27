import {
  normalise,
  BankedObjectionKindSchema,
  type BankedObjectionKind,
  type ObjectionKind,
  type ObjectionReplies,
} from '@impera/contracts';

/**
 * Her answer to what he opposes to a price (ADR 0090 § B): a reply of her bank for that kind of objection, picked by
 * code, never one he already received. The voice says it in her words; the bank is hers, written by the agency.
 */
export interface PickedObjectionReply {
  readonly objection: BankedObjectionKind;
  readonly replyId: string;
  readonly text: string;
}

/**
 * The first reply of her bank for his objection that he never received, in the order the agency wrote them. None
 * left, an objection with no bank (`other`) or none read: nothing, the voice answers alone, with no price moved.
 */
export function pickObjectionReply(
  bank: ObjectionReplies,
  objection: ObjectionKind | undefined,
  usedReplyIds: ReadonlySet<string>,
): PickedObjectionReply | undefined {
  const banked = BankedObjectionKindSchema.safeParse(objection);
  if (!banked.success) return undefined;
  const reply = (bank[banked.data] ?? []).find((r) => !usedReplyIds.has(r.id));
  return reply === undefined ? undefined : { objection: banked.data, replyId: reply.id, text: reply.text };
}

/**
 * His own words ask for a lower price (« fais-moi un prix », « 10 et je prends », « l'autre fois c'était moins cher »):
 * read by code as well as by the brain, which kept reading them as a plain question (passe 2 du 26/11, conversation
 * 23). « C'est trop cher » is the brain's to read: too expensive, not a discount asked.
 */
const DISCOUNT_ASK =
  /\b(fais[- ]moi (un |une )?(prix|geste|petit prix|tarif|effort|reduc|reduction|ristourne|promo|remise)|(une|un|ta|tes|ma) (petite )?(reduc|reduction|ristourne|promo|remise|rabais)\b|moins cher|prix d'ami|a moitie prix|\d+ ?(€|euros?|balles)? (et|pour) (je (prends|l'achete|le prends|la prends|les prends)|c'est (bon|ok))|tu (peux|pourrais|veux) (pas )?(me )?(baisser|descendre|faire moins|faire un prix)|c'est negociable|on (peut )?negoci)/u;

/** The intents a discount asked never overrides: what they say leads (a distress, a complaint, his order). */
const LEADING_INTENTS: readonly string[] = [
  'price_objection',
  'distress',
  'complaint',
  'asks_for_service',
  'asks_to_meet',
  'asks_personal_contact',
  'off_topic_request',
  'asks_if_bot',
];

/**
 * His discount asked, read by code over the brain's intent (ADR 0090 § B): his words carry it and the brain read no
 * price objection nor anything that leads before it. Then she answers it as `asks_discount`, the price never moves.
 */
export function discountAsked(intent: string, fanText: string): boolean {
  return !LEADING_INTENTS.includes(intent) && DISCOUNT_ASK.test(normalise(fanText));
}
