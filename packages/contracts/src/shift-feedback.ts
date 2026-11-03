import { z } from 'zod';

import {
  CreatorIdSchema,
  PlatformAccountIdSchema,
  ShiftFeedbackIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
} from './ids';
import { PayPeriodSchema } from './pay-periods';

/**
 * The mini feedback (`shift_feedback`, ADR 0050 § 10), under `/v1/scheduling`: on an account whose pay reads the
 * platform's sales for the period (source `detected`), it replaces the end-of-shift report. The chatter adds a comment,
 * an incident or signals (`report_signal`, the categories of ADR 0043 § 2), or says there is nothing to report. It
 * carries no amount, nobody validates it, and pay never reads it: a missing one is reminded, never takes anything off.
 *
 * One per shift, made by the shift's member from the time a report would open (`SHIFT_REPORT_OPENS_BEFORE_END_MINUTES`
 * before its end); `id` is made by the client when the panel opens, so a retry records one. It never changes and is
 * never deleted.
 */

/** A signal's category (ADR 0043 § 2): a fan's request, a script or a content that is missing, something else. */
export const REPORT_SIGNAL_CATEGORIES = [
  'fan_request',
  'missing_script',
  'missing_content',
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
 * data, never an instruction (rule 4 of `CLAUDE.md`).
 */
export const ReportSignalSchema = z.object({
  category: ReportSignalCategorySchema,
  text: z.string().trim().min(1).max(280),
});
export type ReportSignal = z.infer<typeof ReportSignalSchema>;

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
 * end-of-shift report is due instead).
 */
export const PutShiftFeedbackBodySchema = z
  .object({
    id: ShiftFeedbackIdSchema,
    nothingToReport: z.boolean(),
    comment: FeedbackTextSchema,
    incident: FeedbackTextSchema,
    signals: z.array(ReportSignalSchema).max(SHIFT_FEEDBACK_SIGNALS_MAX).default([]),
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
  createdAt: z.iso.datetime(),
});
export type ShiftFeedback = z.infer<typeof ShiftFeedbackSchema>;

/** `GET /v1/scheduling/shifts/:shiftId/feedback`: the shift's feedback, `null` before it is made. */
export const ShiftFeedbackReadSchema = z.object({ feedback: ShiftFeedbackSchema.nullable() });
export type ShiftFeedbackRead = z.infer<typeof ShiftFeedbackReadSchema>;

/** The refusals of the feedback, each with its French sentence. */
export const SHIFT_FEEDBACK_ERROR_CODES = [
  'shift_feedback_conflict',
  'shift_feedback_exists_conflict',
  'shift_feedback_early_conflict',
  'shift_feedback_declared_conflict',
  'shift_feedback_forbidden',
] as const;
export const ShiftFeedbackErrorCodeSchema = z.enum(SHIFT_FEEDBACK_ERROR_CODES);
export type ShiftFeedbackErrorCode = z.infer<typeof ShiftFeedbackErrorCodeSchema>;
