import { z } from 'zod';

import { REAUTHENTICATION_ERROR_CODE } from './auth';

/**
 * The owners of the agency (ADR 0096): two at most, the same rights, and one never removes the other without a notice
 * the other can cancel. The rules here are pure; the server applies them under a lock, the screen reads them to say
 * what it offers.
 */

/** Never a third owner (ADR 0096 § 1). */
export const MAX_OWNERS = 2;

/** The notice before an owner removed by the other loses the role (ADR 0096 § 2). */
export const OWNER_REMOVAL_NOTICE_HOURS = 72;

/** When a removal asked at `requestedAt` takes effect. */
export function ownerRemovalEffectiveAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + OWNER_REMOVAL_NOTICE_HOURS * 3_600_000);
}

/** Why an account cannot be made the second owner, in the order the screen tells it. */
export const OWNER_CANDIDATE_REFUSALS = [
  /** Two owners already. */
  'full',
  /** Not an active member of the team: a creator's account, a member away, suspended or gone. */
  'not_a_member',
  /** Its second factor is not active yet: it signs in once first (ADR 0096 § 3). */
  'second_factor_missing',
  /** A removal is waiting for its notice: nothing else changes among the owners meanwhile. */
  'removal_pending',
] as const;
export type OwnerCandidateRefusal = (typeof OWNER_CANDIDATE_REFUSALS)[number];

/** What the rule reads of an account to promote. */
export interface OwnerCandidateFacts {
  readonly owners: number;
  readonly role: 'owner' | 'operator' | 'creator';
  /** A row of the team whose status is `active`. */
  readonly activeMember: boolean;
  readonly secondFactor: boolean;
  readonly removalPending: boolean;
}

/** The first reason an account cannot become the second owner, or `null` when it can. */
export function ownerCandidateRefusal(facts: OwnerCandidateFacts): OwnerCandidateRefusal | null {
  if (facts.owners >= MAX_OWNERS) return 'full';
  if (facts.removalPending) return 'removal_pending';
  if (facts.role !== 'operator' || !facts.activeMember) return 'not_a_member';
  if (!facts.secondFactor) return 'second_factor_missing';
  return null;
}

export const OwnerSchema = z.object({
  userId: z.string().min(1),
  name: z.string(),
  /** The account reading the list. */
  you: z.boolean(),
  secondFactor: z.boolean(),
  passkeys: z.number().int().nonnegative(),
});
export type Owner = z.infer<typeof OwnerSchema>;

/** A member of the team the owner may make the second owner, or why not yet. */
export const OwnerCandidateSchema = z.object({
  userId: z.string().min(1),
  name: z.string(),
  refusal: z.enum(OWNER_CANDIDATE_REFUSALS).nullable(),
});
export type OwnerCandidate = z.infer<typeof OwnerCandidateSchema>;

/** A removal waiting for its notice: who is removed, who asked, and when it takes effect unless cancelled. */
export const OwnerRemovalSchema = z.object({
  id: z.uuid(),
  targetUserId: z.string().min(1),
  requestedBy: z.string().min(1),
  requestedAt: z.iso.datetime(),
  effectiveAt: z.iso.datetime(),
});
export type OwnerRemoval = z.infer<typeof OwnerRemovalSchema>;

/** `GET /v1/settings/security/owners`. */
export const OwnersSchema = z.object({
  owners: z.array(OwnerSchema),
  /** Empty once there are two owners. */
  candidates: z.array(OwnerCandidateSchema),
  removal: OwnerRemovalSchema.nullable(),
  noticeHours: z.number().int().positive(),
});
export type Owners = z.infer<typeof OwnersSchema>;

/** `POST /v1/settings/security/owners`: the account made the second owner. */
export const AddOwnerBodySchema = z.object({ userId: z.string().min(1).max(128) });
export type AddOwnerBody = z.infer<typeof AddOwnerBodySchema>;

export const OWNER_ERROR_CODES = [
  /** Two owners already, or a removal is pending. */
  'owner_conflict',
  /** The account is not one that can be made an owner (`OWNER_CANDIDATE_REFUSALS`, in `details.refusal`). */
  'owner_unprocessable',
  /** No such owner, or no such removal still waiting. */
  'owner_not_found',
  'owner_removal_not_found',
  /** A removal of this owner is already waiting. */
  'owner_removal_conflict',
  /** Only the owner a removal is about cancels it. */
  'owner_removal_forbidden',
  /** A gesture of the team or of the security screen that would shut an owner out: the notice is the only way. */
  'owner_protected_conflict',
  REAUTHENTICATION_ERROR_CODE,
] as const;
export type OwnerErrorCode = (typeof OWNER_ERROR_CODES)[number];
