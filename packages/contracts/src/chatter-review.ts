import { z } from 'zod';

import { CreatorIdSchema, MessageIdSchema, ShiftIdSchema } from './ids';
import { CurrencySchema } from './money';

/**
 * The chatter's review (ADR 0170 §§ B and 26 to 32). The faults themselves, their labels and the agency's rules
 * live in the database, out of this public repository: here, a fault is only a neutral code and its level.
 */

/**
 * How a fault is treated, set by its code and never by the model (ADR 0170 § 28):
 * - `advice`: a piece of advice, never counted;
 * - `standard`: explained the first time, then a firm reminder, a case at three times in two weeks after the
 *   explanation;
 * - `firm`: a firm remark from the first time, a case at the second time in two weeks;
 * - `owner_alert`: a case for the owner from the first time, as fraud or safety.
 */
export const FaultLevelSchema = z.enum(['advice', 'standard', 'firm', 'owner_alert']);
export type FaultLevel = z.infer<typeof FaultLevelSchema>;

/** A fault's neutral code, as the grid names it (`fault.<letters, digits, underscores>`). */
export const FaultCodeSchema = z
  .string()
  .regex(/^fault\.[a-z0-9_]{1,60}$/u)
  .brand<'FaultCode'>();
export type FaultCode = z.infer<typeof FaultCodeSchema>;

/** The tone a card takes, read from the level and the count (ADR 0170 § 30). */
export const FaultToneSchema = z.enum(['advice', 'explain', 'firm', 'grave']);
export type FaultTone = z.infer<typeof FaultToneSchema>;

export const FAULT_LEVELS = FaultLevelSchema.options;

/** How a manager settles a contested remark (ADR 0170 § 14). */
export const RemarkRulingSchema = z.enum(['upheld', 'dropped']);
export type RemarkRuling = z.infer<typeof RemarkRulingSchema>;
export const REMARK_RULINGS = RemarkRulingSchema.options;

/** A fault's label, as the owner saves it out of the repository. */
export const FAULT_LABEL_MAX = 200;
/** A contest in one line (ADR 0170 § 14). */
export const REMARK_CONTEST_MAX = 300;

/** A rule's neutral code, as the grid names it (ADR 0170 § 9). */
export const RuleRefSchema = z
  .string()
  .regex(/^rule\.[a-z0-9_]{1,60}$/u)
  .brand<'RuleRef'>();
export type RuleRef = z.infer<typeof RuleRefSchema>;

/** Where a missed amount comes from (ADR 0170 § 27): always the code's price, never the model's. */
export const MissedSourceSchema = z.enum(['script_step', 'offer_price']);
export type MissedSource = z.infer<typeof MissedSourceSchema>;

const AmountSchema = z.object({ minor: z.number().int().nonnegative(), currency: CurrencySchema });

/** One message of the excerpt, redrawn from the base (§ 12): the fan's pseudonym is never shown. */
export const ReviewExcerptLineSchema = z.object({
  messageId: MessageIdSchema,
  from: z.enum(['fan', 'chatter']),
  text: z.string(),
  at: z.iso.datetime({ offset: true }),
});
export type ReviewExcerptLine = z.infer<typeof ReviewExcerptLineSchema>;

/** A card of « Mon bilan » (ADR 0170 § 26). */
export const ReviewCardSchema = z.object({
  remarkId: z.uuid(),
  kind: z.enum(['fault', 'well_done']),
  faultCode: FaultCodeSchema.nullable(),
  /** The fault's label as the owner saved it; null for a well-done point or a code he has not named yet. */
  label: z.string().nullable(),
  tone: FaultToneSchema.nullable(),
  /** Counted occurrences of the same fault in the last two weeks, this one included (§ 29). */
  counted: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime({ offset: true }),
  fanFeeling: z.string(),
  missed: AmountSchema.extend({ source: MissedSourceSchema }).nullable(),
  earned: AmountSchema.nullable(),
  excerpt: z.array(ReviewExcerptLineSchema),
  alternative: z.array(z.string()),
  ruleRef: RuleRefSchema,
  contest: z.object({ reason: z.string(), ruling: RemarkRulingSchema.nullable() }).nullable(),
});
export type ReviewCard = z.infer<typeof ReviewCardSchema>;

/** « Mon bilan » of one shift (ADR 0170 §§ 12, 26, 27). */
export const MyShiftReviewSchema = z.object({
  shiftId: ShiftIdSchema,
  creatorId: CreatorIdSchema,
  faults: z.array(ReviewCardSchema),
  wellDone: z.array(ReviewCardSchema),
  /** What the code priced, per currency, contests left out until upheld. */
  missedTotals: z.array(AmountSchema),
});
export type MyShiftReview = z.infer<typeof MyShiftReviewSchema>;

export const ReviewShiftParamsSchema = z.object({ shiftId: ShiftIdSchema });
export const ReviewShiftQuerySchema = z.object({ creatorId: CreatorIdSchema });
export const RemarkParamsSchema = z.object({ remarkId: z.uuid() });
export const ContestRemarkBodySchema = z.object({
  creatorId: CreatorIdSchema,
  reason: z.string().trim().min(1).max(REMARK_CONTEST_MAX),
});
export const RuleRemarkBodySchema = z.object({ creatorId: CreatorIdSchema, ruling: RemarkRulingSchema });
export type ContestRemarkBody = z.infer<typeof ContestRemarkBodySchema>;
export type RuleRemarkBody = z.infer<typeof RuleRemarkBodySchema>;

/**
 * Error codes of the chatter review: `review_member_forbidden` 403, « Mon bilan » asked by an account that is no
 * member ; `review_remark_not_found` 404, a remark that is not his, or a contest that does not exist ;
 * `review_ruling_forbidden` 403, a ruling by someone who does not manage the creator, or on his own contest ;
 * `review_shift_not_found` 404, the review of a shift that is not his or does not exist.
 */
export const CHATTER_REVIEW_ERROR_CODES = [
  'review_member_forbidden',
  'review_remark_not_found',
  'review_ruling_forbidden',
  'review_shift_not_found',
] as const;
