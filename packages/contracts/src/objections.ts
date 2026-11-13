import { z } from 'zod';

/**
 * The kinds of price objection the brain reads with `price_objection` (ADR 0090 § 7). `other` has no reply of the
 * bank: the voice answers alone, under the guards. A new kind enters here first.
 */
export const OBJECTION_KINDS = [
  'too_expensive',
  'real_is_cheaper',
  'free_elsewhere',
  'asks_discount',
  'already_paid',
  'other',
] as const;
export const ObjectionKindSchema = z.enum(OBJECTION_KINDS);
export type ObjectionKind = z.infer<typeof ObjectionKindSchema>;

/** The kinds a reply of the bank answers: every kind but `other`. */
export const BANKED_OBJECTION_KINDS = [
  'too_expensive',
  'real_is_cheaper',
  'free_elsewhere',
  'asks_discount',
  'already_paid',
] as const satisfies readonly ObjectionKind[];
export const BankedObjectionKindSchema = z.enum(BANKED_OBJECTION_KINDS);
export type BankedObjectionKind = z.infer<typeof BankedObjectionKindSchema>;

/** What the screen calls each kind, in the fan's words. */
export const OBJECTION_KIND_LABELS: Readonly<Record<BankedObjectionKind, string>> = {
  too_expensive: '« C’est trop cher »',
  real_is_cheaper: '« Pour ce prix j’ai du réel »',
  free_elsewhere: '« Ailleurs c’est gratuit »',
  asks_discount: '« Fais-moi un prix »',
  already_paid: '« J’ai déjà payé la dernière fois »',
};

/** Replies of one kind at most, and the length of one: a reply is a line she adapts, never a script. */
export const OBJECTION_REPLIES_MAX = 30;
export const OBJECTION_REPLY_MAX_LENGTH = 500;
/** An id the screen draws once, never reused: what `objection_reply_used` journals, never the text. */
export const ObjectionReplyIdSchema = z.string().regex(/^[a-z0-9]{8,32}$/u);

export const ObjectionReplySchema = z.strictObject({
  id: ObjectionReplyIdSchema,
  text: z.string().trim().min(1).max(OBJECTION_REPLY_MAX_LENGTH),
});
export type ObjectionReply = z.infer<typeof ObjectionReplySchema>;

const replies = z.array(ObjectionReplySchema).max(OBJECTION_REPLIES_MAX).optional();

/**
 * Her bank of replies to price objections (ADR 0090 § 10), in « Réglages de l'agent », versioned with her persona: an
 * agency method, read by the agent and the owner only, never by her nor by a chatter. Absent in a version written
 * before it: an empty bank.
 */
export const ObjectionRepliesSchema = z
  .strictObject({
    too_expensive: replies,
    real_is_cheaper: replies,
    free_elsewhere: replies,
    asks_discount: replies,
    already_paid: replies,
  } satisfies Record<BankedObjectionKind, typeof replies>)
  .refine(
    (bank) => {
      const ids = Object.values(bank).flatMap((list) => (list ?? []).map((reply) => reply.id));
      return new Set(ids).size === ids.length;
    },
    { message: 'Deux répliques portent le même identifiant' },
  );
export type ObjectionReplies = z.infer<typeof ObjectionRepliesSchema>;
