import {
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
