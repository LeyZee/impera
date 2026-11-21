import { z } from 'zod';

/**
 * The comments left under her own Instagram posts (ADR 0122): what is received, what the model reads, the outcome it
 * gives back, and the ratings of the Playground. A commenter is a third party: nothing here carries a name, a handle
 * nor Meta's own identifier of a person.
 */

/**
 * The rights asked of Meta for comments (ADR 0122 § 1): a closed list in the code. No messaging right ever enters it,
 * and a right granted that is not in it is refused.
 */
export const META_COMMENT_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_comments',
] as const;
export const MetaCommentScopeSchema = z.enum(META_COMMENT_SCOPES);
export type MetaCommentScope = z.infer<typeof MetaCommentScopeSchema>;

/** The rights Meta says it granted that we never asked for: empty when the grant is acceptable. */
export function unexpectedMetaScopes(granted: readonly string[]): string[] {
  const asked: readonly string[] = META_COMMENT_SCOPES;
  return granted.filter((scope) => !asked.includes(scope));
}

/** How Instagram names a comment or a media: opaque to us, the idempotence key of what we do to it. */
export const InstagramCommentRefSchema = z.string().min(1).max(128).brand<'InstagramCommentRef'>();
export type InstagramCommentRef = z.infer<typeof InstagramCommentRefSchema>;
export const InstagramMediaRefSchema = z.string().min(1).max(128).brand<'InstagramMediaRef'>();
export type InstagramMediaRef = z.infer<typeof InstagramMediaRefSchema>;

/**
 * The author of a comment as we keep him (ADR 0122 § 6): a salted hash, enough to tell « has commented before » and
 * to count his answers of the day. Never a handle, never Meta's identifier.
 */
export const CommentAuthorKeySchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u)
  .brand<'CommentAuthorKey'>();
export type CommentAuthorKey = z.infer<typeof CommentAuthorKeySchema>;

export const INSTAGRAM_MEDIA_KINDS = ['reel', 'photo', 'carousel'] as const;
export const InstagramMediaKindSchema = z.enum(INSTAGRAM_MEDIA_KINDS);
export type InstagramMediaKind = z.infer<typeof InstagramMediaKindSchema>;

/** The longest text Instagram lets a comment carry. */
export const INSTAGRAM_COMMENT_MAX = 2200;

/** A comment as the connector hands it over, the author already made opaque. */
export const ReceivedCommentSchema = z.strictObject({
  ref: InstagramCommentRefSchema,
  mediaRef: InstagramMediaRefSchema,
  /** The comment it answers, null for a comment on the post itself. */
  parentRef: InstagramCommentRefSchema.nullable(),
  author: CommentAuthorKeySchema,
  /** Written by her own account: the code ignores it, her answers start nothing (§ 2). */
  fromOwnAccount: z.boolean(),
  text: z.string().max(INSTAGRAM_COMMENT_MAX),
  hidden: z.boolean(),
  at: z.iso.datetime(),
});
export type ReceivedComment = z.infer<typeof ReceivedCommentSchema>;

export const COMMENT_PROMPT_TEXT_MAX = 500;
export const COMMENT_PROMPT_CAPTION_MAX = 300;

/**
 * What the model reads of a comment (ADR 0122 § 2), the untrusted typed block of the prompt: data, never an
 * instruction. Strict: a name or a handle has no field to enter by.
 */
export const CommentPromptInputSchema = z.strictObject({
  comment: z.string().max(COMMENT_PROMPT_TEXT_MAX),
  mediaKind: InstagramMediaKindSchema,
  /** Her caption, cut and cleaned of its links and mentions by the code. */
  caption: z.string().max(COMMENT_PROMPT_CAPTION_MAX),
  postAgeHours: z.number().int().nonnegative(),
  repliesToHer: z.boolean(),
  authorCommentedBefore: z.boolean(),
});
export type CommentPromptInput = z.infer<typeof CommentPromptInputSchema>;

export const COMMENT_REPLY_MAX = 150;
const OUTCOME_REASON_MAX = 200;

/** Why a comment goes to a human (§ 3). The two first are never capped nor outranked. */
export const COMMENT_HANDOFF_REASONS = [
  'age_doubt',
  'distress',
  'meeting_question',
  'price_question',
  'unsupported_language',
  'other',
] as const;
export const CommentHandoffReasonSchema = z.enum(COMMENT_HANDOFF_REASONS);
export type CommentHandoffReason = z.infer<typeof CommentHandoffReasonSchema>;

/**
 * `comment_outcome` (ADR 0122 § 2): what the model gives back for one comment. Deleting is not one of them: the model
 * never deletes.
 */
export const COMMENT_OUTCOME_KINDS = ['reply', 'skip', 'hide', 'handoff'] as const;
export const CommentOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('reply'),
    text: z.string().trim().min(1).max(COMMENT_REPLY_MAX),
    reason: z.string().max(OUTCOME_REASON_MAX),
  }),
  z.strictObject({ kind: z.literal('skip'), reason: z.string().max(OUTCOME_REASON_MAX) }),
  z.strictObject({ kind: z.literal('hide'), reason: z.string().max(OUTCOME_REASON_MAX) }),
  z.strictObject({
    kind: z.literal('handoff'),
    handoff: CommentHandoffReasonSchema,
    reason: z.string().max(OUTCOME_REASON_MAX),
  }),
]);
export type CommentOutcome = z.infer<typeof CommentOutcomeSchema>;
export type CommentOutcomeKind = (typeof COMMENT_OUTCOME_KINDS)[number];

/** The guards of a public reply that the chatting does not have (§ 3). */
export const COMMENT_GUARD_CODES = [
  'comment_format',
  'instagram_text',
  'public_explicit',
  'repeated_reply',
] as const;
export const CommentGuardCodeSchema = z.enum(COMMENT_GUARD_CODES);
export type CommentGuardCode = z.infer<typeof CommentGuardCodeSchema>;

/** A rating of the Playground's « Commentaires » tab (§ 4). Only `validated` counts towards autonomy (§ 5). */
export const COMMENT_RATING_VERDICTS = ['validated', 'corrected', 'refused'] as const;
export const CommentRatingVerdictSchema = z.enum(COMMENT_RATING_VERDICTS);
export type CommentRatingVerdict = z.infer<typeof CommentRatingVerdictSchema>;

export const COMMENT_RATING_REASONS = [
  'not_her_voice',
  'too_long',
  'too_salesy',
  'too_cold',
  'off_topic',
  'should_not_reply',
  'should_reply',
  'should_hide',
  'should_not_hide',
  'other',
] as const;
export const CommentRatingReasonSchema = z.enum(COMMENT_RATING_REASONS);
export type CommentRatingReason = z.infer<typeof CommentRatingReasonSchema>;
