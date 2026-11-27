import { z } from 'zod';

import { PlatformSchema } from './enums';
import { PlatformAccountIdSchema, SaleClaimIdSchema, ShiftIdSchema, TeamMemberIdSchema } from './ids';
import { PayPeriodSchema } from './pay-periods';

/** How far back a chatter may say he was decisive on a sale: his shifts begun in the last 15 days (ADR 0101 § 18). */
export const SALE_CLAIM_WINDOW_DAYS = 15;

/** The most claims a member keeps waiting at once (ADR 0101 § 21). */
export const SALE_CLAIMS_WAITING_MAX = 3;

/** The note a claim or an answer carries: the fan, what happened; data, never an instruction (ADR 0101 § 18). */
export const SALE_CLAIM_NOTE_MAX = 500;
const NoteSchema = z.string().trim().min(1).max(SALE_CLAIM_NOTE_MAX);

/**
 * Where a claim stands (ADR 0101 §§ 19, 20): `waiting` for the validator, `settled` once he gave the sale (« Donner à
 * … ») and said so, `not_retained` with his word, `withdrawn` by its member while it waited.
 */
export const SaleClaimStateSchema = z.enum(['waiting', 'settled', 'not_retained', 'withdrawn']);
export type SaleClaimState = z.infer<typeof SaleClaimStateSchema>;

/** The answer that closes a claim: the validator's two, the member's withdrawal. */
export const SaleClaimOutcomeSchema = z.enum(['settled', 'not_retained', 'withdrawn']);
export type SaleClaimOutcome = z.infer<typeof SaleClaimOutcomeSchema>;

/** The shift a claim is about, as both sides read it: the account and its hours, never a sale. */
export const SaleClaimShiftSchema = z.object({
  shiftId: ShiftIdSchema,
  creatorName: z.string().min(1),
  platformAccountId: PlatformAccountIdSchema,
  platform: PlatformSchema,
  handle: z.string().min(1),
  startsAt: z.iso.datetime(),
  /** When it ended: its stop when it was stopped. */
  endsAt: z.iso.datetime(),
});
export type SaleClaimShift = z.infer<typeof SaleClaimShiftSchema>;

/** A claim, as its member and the validator read it: its shift, its note, and its answer once given. */
export const SaleClaimSchema = z.object({
  id: SaleClaimIdSchema,
  memberId: TeamMemberIdSchema,
  period: PayPeriodSchema,
  shift: SaleClaimShiftSchema,
  note: z.string().min(1),
  state: SaleClaimStateSchema,
  /** The validator's word on `not_retained`, his optional one on `settled`; null otherwise. */
  answerNote: z.string().min(1).nullable(),
  createdAt: z.iso.datetime(),
  answeredAt: z.iso.datetime().nullable(),
});
export type SaleClaim = z.infer<typeof SaleClaimSchema>;

/**
 * `GET /v1/payroll/sale-claims/mine` (any member): his claims, the newest first, and the shifts he may still claim on
 * (ended, begun in the last 15 days, in an open fortnight, none claimed yet), the newest first.
 */
export const MySaleClaimsSchema = z.object({
  claims: z.array(SaleClaimSchema),
  shifts: z.array(SaleClaimShiftSchema),
});
export type MySaleClaims = z.infer<typeof MySaleClaimsSchema>;

/** A claim as the validator reads it in « Ventes en attente »: its member's display name. */
export const PendingSaleClaimSchema = SaleClaimSchema.extend({ memberName: z.string().min(1) });
export type PendingSaleClaim = z.infer<typeof PendingSaleClaimSchema>;

/** `GET /v1/payroll/sale-claims` (owner, active manager): the claims waiting, the oldest first. */
export const PendingSaleClaimsSchema = z.object({ claims: z.array(PendingSaleClaimSchema) });
export type PendingSaleClaims = z.infer<typeof PendingSaleClaimsSchema>;

/**
 * `POST /v1/payroll/sale-claims` (any member, on his own shift) → 201 `SaleClaimSchema`, 200 for the same `id` and
 * values. Refused on a shift not his, not ended, begun more than 15 days ago, in a closed fortnight, already claimed,
 * or past his 3 claims waiting.
 */
export const CreateSaleClaimBodySchema = z.object({
  id: SaleClaimIdSchema,
  shiftId: ShiftIdSchema,
  note: NoteSchema,
});
export type CreateSaleClaimBody = z.infer<typeof CreateSaleClaimBodySchema>;

/**
 * `POST /v1/payroll/sale-claims/:saleClaimId/answer` → 200 `SaleClaimSchema`. `withdrawn` by its member alone;
 * `settled` and `not_retained` by the owner or an active manager who is not its member, `not_retained` with a note.
 * Once only: the same answer again returns the claim, another one `sale_claim_answered_conflict`.
 */
export const AnswerSaleClaimBodySchema = z
  .object({ outcome: SaleClaimOutcomeSchema, note: NoteSchema.nullable() })
  .refine((body) => body.outcome !== 'not_retained' || body.note !== null, {
    message: 'Un mot pour le chatteur',
    path: ['note'],
  });
export type AnswerSaleClaimBody = z.infer<typeof AnswerSaleClaimBodySchema>;

export const SaleClaimParamsSchema = z.object({ saleClaimId: SaleClaimIdSchema });
