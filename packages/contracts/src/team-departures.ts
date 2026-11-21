import { z } from 'zod';

import { MemberDepartureIdSchema, TeamMemberIdSchema, UserIdSchema } from './ids';

/**
 * A member's departure (ADR 0166, EQ-14): the owner sets the hour it ends, then a job applies it at that hour. Until
 * then it can be cancelled; once applied, the member keeps only his departure space.
 */

export const MEMBER_DEPARTURE_STATES = ['scheduled', 'applied', 'cancelled'] as const;
export const MemberDepartureStateSchema = z.enum(MEMBER_DEPARTURE_STATES);
export type MemberDepartureState = z.infer<typeof MemberDepartureStateSchema>;

/** How far ahead a departure may be set (ADR 0166 § 1). */
export const DEPARTURE_MAX_DAYS_AHEAD = 31;
/** The internal reason, a note of the member's record: read by the owner and the managers, never by the member. */
export const DEPARTURE_REASON_MAX = 500;

/** One departure as the owner reads it in Équipe. */
export const MemberDepartureSchema = z.object({
  id: MemberDepartureIdSchema,
  memberId: TeamMemberIdSchema,
  state: MemberDepartureStateSchema,
  endsAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  appliedAt: z.iso.datetime().nullable(),
  /** « Accès Reveal retiré », ticked by the owner (ADR 0166 § 3); amber in Équipe while `null` on an applied one. */
  revealRemovedAt: z.iso.datetime().nullable(),
  revealRemovedBy: UserIdSchema.nullable(),
});
export type MemberDeparture = z.infer<typeof MemberDepartureSchema>;

/** `GET /v1/team/departures` (owner): those scheduled, and those applied whose Reveal access is not ticked yet. */
export const MemberDepartureListSchema = z.object({ departures: z.array(MemberDepartureSchema) });
export type MemberDepartureList = z.infer<typeof MemberDepartureListSchema>;

/**
 * `POST /v1/team/members/:memberId/departure` (owner, recent sign-in): `endsAt` now or later, within
 * `DEPARTURE_MAX_DAYS_AHEAD` days; `null` means now.
 */
export const ScheduleDepartureBodySchema = z.object({
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  reason: z.string().trim().min(1).max(DEPARTURE_REASON_MAX).nullable(),
});
export type ScheduleDepartureBody = z.infer<typeof ScheduleDepartureBodySchema>;

export const DepartureParamsSchema = z.object({ departureId: MemberDepartureIdSchema });

/**
 * Error codes (the suffix gives the status): `member_departure_required_conflict` 409, « Parti » asked through the
 * status, which only « Faire partir » sets; `member_departure_conflict` 409, a departure already scheduled, or one
 * no longer scheduled (cancelled, applied); `member_departure_date_invalid` 400, an hour past or too far;
 * `member_departure_not_found` 404; `departure_space_forbidden` 403, a member who left asks a route outside his space.
 */
export const MEMBER_DEPARTURE_ERROR_CODES = [
  'member_departure_required_conflict',
  'member_departure_conflict',
  'member_departure_date_invalid',
  'member_departure_not_found',
  'departure_space_forbidden',
] as const;
export type MemberDepartureErrorCode = (typeof MEMBER_DEPARTURE_ERROR_CODES)[number];
