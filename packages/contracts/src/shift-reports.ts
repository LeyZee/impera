import { z } from 'zod';

import {
  CreatorIdSchema,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  ShiftReportIdSchema,
  TeamMemberIdSchema,
} from './ids';
import { CurrencySchema, MoneySchema } from './money';
import { PayPeriodSchema } from './pay-periods';
import { EarningsSourceSchema } from './pay-rules';
import { PlanningAccountSchema, PlanningMemberSchema, ShiftSchema } from './scheduling';

/**
 * End-of-shift reports (EQ-03, ADR 0023), under `/v1/scheduling`. At the end of their shift, the member declares what it
 * brought in, in the account's currency; the owner or an active manager validates it, or sends it back with a note.
 * Validated reports are what pay reads for an account whose source is `declared` for the period (EQ-04).
 *
 * One report per shift: `id` is made by the client when the form opens, so a retry records one report. A validated
 * report never changes: a correction is a new row that names it (`correctsId`), with what to add or take off, and goes
 * through the same validation. Nothing is ever deleted.
 *
 * A report keeps the period its shift starts in, in the agency's zone, read when it is made (`PayPeriodSchema`). A
 * report that comes after pay has validated that period for the member is not refused: pay carries it to the next
 * open period (Imperium's rule, ADR 0023 § Paie, EQ-04). Every write to a report takes the advisory lock (member,
 * period) that validating the member's pay takes too.
 */

/** The highest amount one report or correction declares, in minor units (50 000 in the currency): a slip guard. */
export const SHIFT_REPORT_MAX_MINOR = 5_000_000;

/**
 * How long before its end a shift takes its report, never before it starts: the member makes it as the shift closes,
 * not hours ahead.
 */
export const SHIFT_REPORT_OPENS_BEFORE_END_MINUTES = 30;

/** The most reports one validation sends: the screen validates what it shows, in one gesture. */
export const SHIFT_REPORT_BATCH_MAX = 100;

/**
 * `submitted`: sent, waiting for the agency, and its member can still change it. `validated`: pay reads it, and it
 * never changes again. `rejected`: sent back with a note; when its member changes it, or sends it again as it is, it
 * is `submitted` again.
 */
export const SHIFT_REPORT_STATUSES = ['submitted', 'validated', 'rejected'] as const;
export const ShiftReportStatusSchema = z.enum(SHIFT_REPORT_STATUSES);
export type ShiftReportStatus = z.infer<typeof ShiftReportStatusSchema>;

/** A trimmed free text of 1000 characters at most; empty means none. Never a fan's data. */
const ReportTextSchema = z
  .string()
  .trim()
  .max(1000)
  .nullish()
  .transform((value) => (value === undefined || value === null || value === '' ? null : value));

const AmountMinorSchema = z.number().int().min(-SHIFT_REPORT_MAX_MINOR).max(SHIFT_REPORT_MAX_MINOR);

/**
 * What a report or a correction says of its amount: a report declares the gross, 0 or more (a shift that sold
 * nothing says so); a correction adds or takes off, never 0. Only a report signals an incident.
 */
function checkAmount(
  row: { readonly correctsId: string | null; readonly amountMinor: number; readonly incident: string | null },
  context: z.RefinementCtx,
): void {
  if (row.correctsId === null && row.amountMinor < 0) {
    context.addIssue({ code: 'custom', message: 'Un rapport déclare 0 ou plus', path: ['amountMinor'] });
  }
  if (row.correctsId !== null && row.amountMinor === 0) {
    context.addIssue({ code: 'custom', message: 'Une correction change le montant', path: ['amountMinor'] });
  }
  if (row.correctsId !== null && row.incident !== null) {
    context.addIssue({
      code: 'custom',
      message: 'Un incident se signale sur le rapport',
      path: ['incident'],
    });
  }
}

/**
 * A report (`correctsId` `null`) or a correction of a validated one. `amount` is in the account's currency for the
 * period. `byAgency` is `true` for a correction the owner or an active manager made (a refund the member did not
 * declare), `false` for what the member made. `version` grows by one at each change, and a review names the version it
 * read, so nobody validates an amount they did not see. `canReview` says whether the reader may validate it or send it
 * back now (`mayReviewShiftReport`). Who made, validated or sent it back is kept on the row and in `audit_log`.
 */
export const ShiftReportSchema = z
  .object({
    id: ShiftReportIdSchema,
    shiftId: ShiftIdSchema,
    creatorId: CreatorIdSchema,
    platformAccountId: PlatformAccountIdSchema,
    memberId: TeamMemberIdSchema,
    period: PayPeriodSchema,
    correctsId: ShiftReportIdSchema.nullable(),
    amount: MoneySchema.extend({ amountMinor: AmountMinorSchema }),
    comment: z.string().nullable(),
    /** What went wrong during the shift, said to the agency; `null` when nothing did. */
    incident: z.string().nullable(),
    status: ShiftReportStatusSchema,
    version: z.number().int().min(1),
    byAgency: z.boolean(),
    canReview: z.boolean(),
    /** When it was last sent: made, changed, or sent again after it came back. */
    submittedAt: z.iso.datetime(),
    /** When it was validated or sent back; `null` while submitted. */
    reviewedAt: z.iso.datetime().nullable(),
    /** What the person who sent it back wrote, for the member; `null` otherwise. */
    reviewNote: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .superRefine((report, context) => {
    checkAmount({ ...report, amountMinor: report.amount.amountMinor }, context);
  });
export type ShiftReport = z.infer<typeof ShiftReportSchema>;

/**
 * `GET /v1/scheduling/shifts/:shiftId/report` (the shift's member, the owner, an active manager): what the « Faire mon
 * rapport » panel needs. `period` is the shift's, `opensAt` when a report is accepted
 * (`SHIFT_REPORT_OPENS_BEFORE_END_MINUTES` before its end, or its start for a shorter shift), `rules` the currency and source in force for the period,
 * `null` while the account has none, and `reports` the shift's report and its corrections, oldest first.
 */
export const ShiftReportContextSchema = z.object({
  shift: ShiftSchema,
  account: PlanningAccountSchema,
  period: PayPeriodSchema,
  opensAt: z.iso.datetime(),
  rules: z.object({ currency: CurrencySchema, earningsSource: EarningsSourceSchema }).nullable(),
  reports: z.array(ShiftReportSchema),
});
export type ShiftReportContext = z.infer<typeof ShiftReportContextSchema>;

/**
 * `POST /v1/scheduling/shift-reports` → 201 `ShiftReportSchema`, or 200 when the same `id` was already recorded with
 * the same values (`shift_report_conflict` otherwise).
 *
 * A report (`correctsId` `null`) is made by the shift's member alone, from `opensAt` (`shift_report_early_conflict`), on a shift that is not cancelled (`shift_not_found`); a second one
 * for the shift answers `shift_report_exists_conflict` with `details.shiftReportId`. A correction names the shift's
 * validated report (`shift_report_validated_conflict` while it is not), made by the shift's member or by the owner or
 * an active manager, and never takes the shift's validated total below 0 (`shift_report_total_conflict`,
 * `validatedTotalWith`).
 *
 * Both are refused while the account has no pay rules for the period (`pay_rules_missing_conflict`), when its source
 * is `detected` then (`shift_report_detected_conflict`: pay reads the sales, never both), and in another currency than
 * the rules' (`shift_report_currency_conflict`, say, after the rules changed under the open panel).
 */
export const CreateShiftReportBodySchema = z
  .object({
    id: ShiftReportIdSchema,
    shiftId: ShiftIdSchema,
    correctsId: ShiftReportIdSchema.nullish().transform((value) => value ?? null),
    amountMinor: AmountMinorSchema,
    currency: CurrencySchema,
    comment: ReportTextSchema,
    incident: ReportTextSchema,
  })
  .superRefine(checkAmount);
export type CreateShiftReportBody = z.input<typeof CreateShiftReportBodySchema>;

/**
 * `PATCH /v1/scheduling/shift-reports/:shiftReportId` (its maker: the shift's member, or for a correction made by the
 * agency, the owner or an active manager) → 200 `ShiftReportSchema`. `version` is the one the screen read
 * (`shift_report_changed_conflict` otherwise). A submitted report changes and stays submitted; a rejected one changes,
 * or is sent again as it is with no other field, and is submitted again; a validated one answers
 * `shift_report_validated_conflict`: correct it instead. The amount keeps the rules' currency, and the rules of
 * `POST`.
 */
export const UpdateShiftReportBodySchema = z.object({
  version: z.number().int().min(1),
  amountMinor: AmountMinorSchema.optional(),
  comment: ReportTextSchema.optional(),
  incident: ReportTextSchema.optional(),
});
export type UpdateShiftReportBody = z.input<typeof UpdateShiftReportBodySchema>;

const ReviewedVersionSchema = z.object({ id: ShiftReportIdSchema, version: z.number().int().min(1) });

/**
 * `POST /v1/scheduling/shift-reports/validate` (owner, active manager) → 200 `ValidateShiftReportsResultSchema`. Each
 * report is validated on its own, in its own transaction, under the lock (member, period): one that changed since the
 * screen read it, or is no longer submitted, comes back refused with its code (`shift_report_changed_conflict`), and
 * the others go through. The validation checks the shift's validated total again (`validatedTotalWith`): two negative
 * corrections can each pass their making and together take it below 0, and the second answers
 * `shift_report_total_conflict`. `mayReviewShiftReport` says who may review (`shift_report_own_review_forbidden`).
 */
export const ValidateShiftReportsBodySchema = z.object({
  reports: z
    .array(ReviewedVersionSchema)
    .min(1)
    .max(SHIFT_REPORT_BATCH_MAX)
    .refine(
      (reports) => new Set(reports.map((one) => one.id)).size === reports.length,
      'Un rapport une fois',
    ),
});
export type ValidateShiftReportsBody = z.infer<typeof ValidateShiftReportsBodySchema>;

/**
 * `POST /v1/scheduling/shift-reports/:shiftReportId/reject` (owner, active manager) → 200 `ShiftReportSchema`: a
 * submitted report goes back to its maker with a note that says what to look at (`shift_report_changed_conflict`,
 * `shift_report_own_review_forbidden` as for a validation).
 */
export const RejectShiftReportBodySchema = z.object({
  version: z.number().int().min(1),
  note: z.string().trim().min(1).max(500),
});
export type RejectShiftReportBody = z.infer<typeof RejectShiftReportBodySchema>;

/**
 * Who reviews (validates or sends back) a submitted report: the owner or an active manager, never on a report of their
 * own shift, and four eyes on a correction the agency made: a manager never reviews one they made, the owner reviews
 * theirs, since nobody reviews for them (as for a leave, ADR 0031). The server says it to the reader in `canReview`.
 */
export function mayReviewShiftReport(review: {
  readonly status: ShiftReportStatus;
  readonly readerIsAgency: boolean;
  readonly readerIsOwner: boolean;
  readonly readerIsShiftMember: boolean;
  readonly readerMadeIt: boolean;
}): boolean {
  return (
    review.status === 'submitted' &&
    review.readerIsAgency &&
    !review.readerIsShiftMember &&
    (review.readerIsOwner || !review.readerMadeIt)
  );
}

/**
 * The shift's validated total, in minor units, once `next` is validated too: the validated report and corrections of
 * the shift, `next` counted once. Below 0, making or validating `next` answers `shift_report_total_conflict`: checked
 * when a correction is made, and again under the lock when it is validated.
 */
export function validatedTotalWith(
  reports: readonly {
    readonly id: string;
    readonly status: ShiftReportStatus;
    readonly amount: { readonly amountMinor: number };
  }[],
  next: { readonly id: string; readonly amount: { readonly amountMinor: number } },
): number {
  return reports
    .filter((one) => one.status === 'validated' && one.id !== next.id)
    .reduce((total, one) => total + one.amount.amountMinor, next.amount.amountMinor);
}

/**
 * `GET /v1/scheduling/shift-reports?period=…`: with `period`, its reports and corrections, and the shifts that start in
 * it, are not cancelled and take a report already (`opensAt` passed), reported or not: a shift with none is a
 * « Sans rapport » line. Without, the reports still open (submitted or rejected) of every period, and the shifts they
 * name: what the agency has to validate. The owner and an active manager read every member's; any other member reads
 * their own, and `members` holds themselves alone.
 */
export const ShiftReportQuerySchema = z.object({ period: PayPeriodSchema.optional() });
export type ShiftReportQuery = z.infer<typeof ShiftReportQuerySchema>;

export const ShiftReportListSchema = z.object({
  reports: z.array(ShiftReportSchema),
  shifts: z.array(ShiftSchema),
  accounts: z.array(PlanningAccountSchema),
  members: z.array(PlanningMemberSchema),
});
export type ShiftReportList = z.infer<typeof ShiftReportListSchema>;

/**
 * The error codes of the reports, for the screens to say them in French (the suffix gives the status, api.md):
 * `shift_not_found` 404 ; `shift_report_not_found` 404 ; `shift_report_conflict` 409, the same `id` with other values ;
 * `shift_report_exists_conflict` 409, the shift already has its report (`details.shiftReportId`) ;
 * `shift_report_early_conflict` 409, the shift does not take its report yet ; `shift_report_changed_conflict` 409, the
 * report changed since the screen read it, or is no longer in a state that allows this ;
 * `shift_report_validated_conflict` 409, a validated report is corrected, not changed, and only a validated one is ;
 * `shift_report_total_conflict` 409, a correction that would take the shift's validated total below 0 ;
 * `shift_report_detected_conflict` 409, the account's source is `detected` for the period ;
 * `shift_report_currency_conflict` 409, another currency than the account's for the period ;
 * `pay_rules_missing_conflict` 409, the account has no pay rules for the period ;
 * `shift_report_own_review_forbidden` 403, a report of one's own shift, or a correction one made as a manager ; `shift_report_forbidden` 403, a report of
 * someone else's shift, or a change to what someone else made.
 */
export const SHIFT_REPORT_ERROR_CODES = [
  'shift_not_found',
  'shift_report_not_found',
  'shift_report_conflict',
  'shift_report_exists_conflict',
  'shift_report_early_conflict',
  'shift_report_changed_conflict',
  'shift_report_validated_conflict',
  'shift_report_total_conflict',
  'shift_report_detected_conflict',
  'shift_report_currency_conflict',
  'pay_rules_missing_conflict',
  'shift_report_own_review_forbidden',
  'shift_report_forbidden',
] as const;
export const ShiftReportErrorCodeSchema = z.enum(SHIFT_REPORT_ERROR_CODES);
export type ShiftReportErrorCode = z.infer<typeof ShiftReportErrorCodeSchema>;

/** What a validation answers for each report it was sent, in the order sent. */
export const ValidateShiftReportsResultSchema = z.object({
  results: z.array(
    z.discriminatedUnion('outcome', [
      z.object({ outcome: z.literal('validated'), report: ShiftReportSchema }),
      z.object({ outcome: z.literal('refused'), id: ShiftReportIdSchema, code: ShiftReportErrorCodeSchema }),
    ]),
  ),
});
export type ValidateShiftReportsResult = z.infer<typeof ValidateShiftReportsResultSchema>;
