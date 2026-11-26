import { z } from 'zod';

import {
  ConversationIdSchema,
  CreatorIdSchema,
  PlatformAccountIdSchema,
  ShiftFeedbackIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
} from './ids';
import { CurrencySchema } from './money';
import { PayPeriodSchema } from './pay-periods';
import { PlanningAccountSchema, PlanningMemberSchema } from './scheduling';

/**
 * The mini feedback (`shift_feedback`, ADR 0050 § 10), under `/v1/scheduling`: on an account whose pay reads the
 * platform's sales for the period (source `detected`), it replaces the end-of-shift report. The chatter adds a comment,
 * an incident or signals (`report_signal`, the categories of ADR 0043 § 2), or says there is nothing to report. It
 * carries no amount, nobody validates it, and pay never reads it: a missing one is reminded, never takes anything off.
 *
 * One per shift, made by the shift's member from the time a report would open (`SHIFT_REPORT_OPENS_BEFORE_END_MINUTES`
 * before its end); `id` is made by the client when the panel opens, so a retry records one. It never changes and is
 * never deleted.
 *
 * An incident is followed (trous béants n° 1, 21/11): the owner and the active managers are told at once on their
 * phone, and say « Vu » then « Réglé » (`shift_incident_steps`, each once, never undone); the chatter reads where it is.
 */

/**
 * A signal's category (ADR 0043 § 2): a fan's request, a script or a content that is missing, something else; and,
 * since the shift review (ADR 0170 § 2), something about the agent or an idea.
 */
export const REPORT_SIGNAL_CATEGORIES = [
  'fan_request',
  'missing_script',
  'missing_content',
  'agent',
  'idea',
  'other',
] as const;
export const ReportSignalCategorySchema = z.enum(REPORT_SIGNAL_CATEGORIES);
export type ReportSignalCategory = z.infer<typeof ReportSignalCategorySchema>;

/** The most signals one feedback carries. */
export const SHIFT_FEEDBACK_SIGNALS_MAX = 5;

const FeedbackTextSchema = z
  .string()
  .trim()
  .max(1000)
  .nullish()
  .transform((value) => (value === undefined || value === null || value === '' ? null : value));

/**
 * What the chatter signals for the creator's week (ADR 0042 § 5): a category and a sentence. A fan's name in it stays
 * data, never an instruction (rule 4 of `CLAUDE.md`). « Lier à un fan » (ADR 0170 § 2): the conversation of a fan of
 * his shift, picked in `ShiftDigest.fans`, never typed; the sentence then goes into that fan's card, as a note « par
 * un chatteur » (§ 4). Null: linked to nobody, as every signal written before.
 */
export const ReportSignalSchema = z.object({
  category: ReportSignalCategorySchema,
  text: z.string().trim().min(1).max(280),
  conversationId: ConversationIdSchema.nullable().default(null),
});
export type ReportSignal = z.infer<typeof ReportSignalSchema>;

/**
 * Why he corrected so many of the agent's drafts (ADR 0170 § 1), a closed choice asked only when `draftReasonAsked`:
 * too long, not in her way of writing, a sale offered too early, it forgot what the fan said, something else.
 */
export const DRAFT_REASONS = ['too_long', 'not_her_voice', 'sale_too_early', 'forgot_fan', 'other'] as const;
export const DraftReasonSchema = z.enum(DRAFT_REASONS);
export type DraftReason = z.infer<typeof DraftReasonSchema>;

/** A shift's drafts as its member decided them: sent as they were, corrected, thrown away. */
export const ShiftDraftCountsSchema = z.object({
  asIs: z.int().nonnegative(),
  edited: z.int().nonnegative(),
  rejected: z.int().nonnegative(),
});
export type ShiftDraftCounts = z.infer<typeof ShiftDraftCountsSchema>;

/** The question is asked from this many drafts corrected or thrown away… */
export const DRAFT_REASON_MIN_CHANGED = 5;
/** …when they are at least this share of his drafts, in per cent. */
export const DRAFT_REASON_MIN_SHARE_PERCENT = 40;

/** « Tu as corrigé beaucoup de brouillons » (ADR 0170 § 1): the rule is the code's, the same for the panel and the server. */
export function draftReasonAsked(drafts: ShiftDraftCounts): boolean {
  const changed = drafts.edited + drafts.rejected;
  const all = changed + drafts.asIs;
  return changed >= DRAFT_REASON_MIN_CHANGED && changed * 100 >= all * DRAFT_REASON_MIN_SHARE_PERCENT;
}

/** The most fans of his shift « Lier à un fan » offers, the last written to first. */
export const SHIFT_DIGEST_FANS_MAX = 30;

/**
 * His shift in figures (ADR 0170 § 1), read by Impera, nothing to type: the sales the platform's register gives him over
 * the shift (`feed` other than `read`: the register says nothing, see `ShiftSales` of the connectors), the agent's
 * drafts he decided, the conversations the agent handed to the team on the account, and the fans written to during the
 * shift, for « Lier à un fan ». A fan is named as the platform shows him to the chatter; never in a capture.
 */
export const ShiftDigestSchema = z.object({
  sales: z.discriminatedUnion('feed', [
    z.object({
      feed: z.literal('read'),
      count: z.int().nonnegative(),
      grossInclVatMinor: z.int(),
      currency: CurrencySchema,
    }),
    z.object({ feed: z.enum(['none', 'off', 'model_unlinked', 'chatter_unlinked']) }),
  ]),
  drafts: ShiftDraftCountsSchema,
  handoffs: z.int().nonnegative(),
  fans: z
    .array(
      z.object({
        conversationId: ConversationIdSchema,
        name: z.string(),
        messages: z.int().positive(),
        lastAt: z.iso.datetime(),
      }),
    )
    .max(SHIFT_DIGEST_FANS_MAX),
});
export type ShiftDigest = z.infer<typeof ShiftDigestSchema>;

/** Either nothing to report, or at least one of a comment, an incident, a signal: never both, never neither. */
function checkSaid(
  feedback: {
    readonly nothingToReport: boolean;
    readonly comment: string | null;
    readonly incident: string | null;
    readonly signals: readonly ReportSignal[];
  },
  context: z.RefinementCtx,
): void {
  const said = feedback.comment !== null || feedback.incident !== null || feedback.signals.length > 0;
  if (said === feedback.nothingToReport) {
    context.addIssue({
      code: 'custom',
      path: ['nothingToReport'],
      message: feedback.nothingToReport
        ? '« Rien à signaler » ne porte ni commentaire, ni incident, ni remontée'
        : 'Écris un commentaire, un incident ou une remontée, ou touche « rien à signaler »',
    });
  }
}

/**
 * `PUT /v1/scheduling/shifts/:shiftId/feedback` → 201 `ShiftFeedbackSchema`, or 200 when the same `id` was already
 * recorded with the same values (`shift_feedback_conflict` otherwise). Refused before it opens
 * (`shift_feedback_early_conflict`, `details.opensAt`), on a cancelled shift (`shift_not_found`), by anyone but the
 * shift's member (`shift_feedback_forbidden`), when the shift has one already (`shift_feedback_exists_conflict`), and
 * when the account's source is not `detected` for the shift's period (`shift_feedback_declared_conflict`: the
 * end-of-shift report is due instead). A signal linked to a conversation that is not among his shift's fans is refused
 * (`shift_feedback_fan_conflict`), as an answer to the closed question when it was not asked
 * (`shift_feedback_reason_conflict`). Only his last shift takes one (retour léger, 26/11): once a later shift of his
 * opens its feedback, an older one is refused (`shift_feedback_expired_conflict`) and counts as missing.
 */
export const PutShiftFeedbackBodySchema = z
  .object({
    id: ShiftFeedbackIdSchema,
    nothingToReport: z.boolean(),
    comment: FeedbackTextSchema,
    incident: FeedbackTextSchema,
    signals: z.array(ReportSignalSchema).max(SHIFT_FEEDBACK_SIGNALS_MAX).default([]),
    /** The answer to the closed question; refused (`shift_feedback_reason_conflict`) when it was not asked. */
    draftReason: DraftReasonSchema.nullish().transform((value) => value ?? null),
  })
  .superRefine(checkSaid);
export type PutShiftFeedbackBody = z.input<typeof PutShiftFeedbackBodySchema>;

/** A shift's mini feedback, as its member, the owner and an active manager read it; never the creator. */
export const ShiftFeedbackSchema = z.object({
  id: ShiftFeedbackIdSchema,
  shiftId: ShiftIdSchema,
  creatorId: CreatorIdSchema,
  platformAccountId: PlatformAccountIdSchema,
  memberId: TeamMemberIdSchema,
  /** The pay period its shift starts in, in the agency's zone, as read when it was made. */
  period: PayPeriodSchema,
  nothingToReport: z.boolean(),
  comment: z.string().nullable(),
  incident: z.string().nullable(),
  signals: z.array(ReportSignalSchema),
  draftReason: DraftReasonSchema.nullable(),
  createdAt: z.iso.datetime(),
  /** When the owner or a manager said « Vu » on its incident; « Réglé » counts as seen. Null without an incident. */
  incidentSeenAt: z.iso.datetime().nullable(),
  /** When the owner or a manager said « Réglé » on its incident. Null without an incident or until then. */
  incidentResolvedAt: z.iso.datetime().nullable(),
});
export type ShiftFeedback = z.infer<typeof ShiftFeedbackSchema>;

/** Where an incident stands, as the screens say it: sent, « Vu », « Réglé ». */
export const SHIFT_INCIDENT_STEPS = ['seen', 'resolved'] as const;
export const ShiftIncidentStepSchema = z.enum(SHIFT_INCIDENT_STEPS);
export type ShiftIncidentStep = z.infer<typeof ShiftIncidentStepSchema>;

/**
 * `POST /v1/scheduling/shift-feedback/:shiftFeedbackId/incident` → 200 `ShiftFeedbackSchema`: the owner or an active
 * manager says « Vu » or « Réglé » on an incident, never on their own; the same step said again gives back what is
 * recorded. 404 `shift_feedback_not_found` for a feedback the reader does not see or without an incident; 403
 * `shift_incident_forbidden` for a chatter or the incident's own author.
 */
export const ShiftIncidentStepBodySchema = z.strictObject({ step: ShiftIncidentStepSchema });
export type ShiftIncidentStepBody = z.infer<typeof ShiftIncidentStepBodySchema>;

/**
 * `GET /v1/scheduling/shift-feedback?period=`: the feedbacks of a period (the owner and the active managers: every
 * member's, on the creators of their list; anyone else: their own), with their accounts and members for the lines.
 * Without `period`, the incidents not « Réglé » yet, every period: what the agency still has to look at. Incidents not
 * réglés come first, then the most recent.
 */
export const ShiftFeedbackQuerySchema = z.object({ period: PayPeriodSchema.optional() });
export type ShiftFeedbackQuery = z.infer<typeof ShiftFeedbackQuerySchema>;

export const ShiftFeedbackListSchema = z.object({
  feedbacks: z.array(
    ShiftFeedbackSchema.extend({ shiftStartsAt: z.iso.datetime(), shiftEndsAt: z.iso.datetime() }),
  ),
  /**
   * With a period, for the agency: the shifts left without their feedback (retour léger, 26/11), a later shift of their
   * member having opened its own. Empty without a period and for anyone else.
   */
  missing: z.array(
    z.object({
      shiftId: ShiftIdSchema,
      creatorId: CreatorIdSchema,
      platformAccountId: PlatformAccountIdSchema,
      memberId: TeamMemberIdSchema,
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
    }),
  ),
  accounts: z.array(PlanningAccountSchema),
  members: z.array(PlanningMemberSchema),
});
export type ShiftFeedbackList = z.infer<typeof ShiftFeedbackListSchema>;
export type ShiftFeedbackLine = ShiftFeedbackList['feedbacks'][number];

/**
 * `GET /v1/scheduling/shifts/:shiftId/feedback`: the shift's feedback, `null` before it is made, and its figures
 * (`ShiftDigest`), read again at each request.
 */
export const ShiftFeedbackReadSchema = z.object({
  feedback: ShiftFeedbackSchema.nullable(),
  digest: ShiftDigestSchema,
});
export type ShiftFeedbackRead = z.infer<typeof ShiftFeedbackReadSchema>;

/**
 * `GET /v1/scheduling/shift-feedback/pending` (any member, for himself): the one feedback he still owes, or `null`
 * (retour léger, 26/11). It is his last shift whose feedback has opened, on an account whose pay reads the sales, while
 * it has none: never more than one. « Je prends mon poste » asks for it first (`shift_check_in_feedback_due_conflict`).
 */
export const ShiftFeedbackPendingSchema = z.object({
  pending: z
    .object({
      shiftId: ShiftIdSchema,
      creatorId: CreatorIdSchema,
      platformAccountId: PlatformAccountIdSchema,
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
    })
    .nullable(),
});
export type ShiftFeedbackPending = z.infer<typeof ShiftFeedbackPendingSchema>;

/** The refusals of the feedback, each with its French sentence. */
export const SHIFT_FEEDBACK_ERROR_CODES = [
  'shift_feedback_conflict',
  'shift_feedback_exists_conflict',
  'shift_feedback_early_conflict',
  'shift_feedback_declared_conflict',
  'shift_feedback_forbidden',
  'shift_feedback_not_found',
  'shift_incident_forbidden',
  'shift_feedback_fan_conflict',
  'shift_feedback_reason_conflict',
  'shift_feedback_expired_conflict',
] as const;
export const ShiftFeedbackErrorCodeSchema = z.enum(SHIFT_FEEDBACK_ERROR_CODES);
export type ShiftFeedbackErrorCode = z.infer<typeof ShiftFeedbackErrorCodeSchema>;
