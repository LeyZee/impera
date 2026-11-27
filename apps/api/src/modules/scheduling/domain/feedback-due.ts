import {
  draftReasonAsked,
  type ConversationId,
  type CreatorId,
  type DraftReason,
  type PlatformAccountId,
  type ReportSignal,
  type ShiftDraftCounts,
  type ShiftId,
  type TeamMemberId,
} from '@impera/contracts';

import {
  ShiftCheckInFeedbackDue,
  ShiftFeedbackExpired,
  ShiftFeedbackFanConflict,
  ShiftFeedbackReasonConflict,
} from './errors';

/**
 * The light feedback (Charles, « ok rapport léger », 26/11, on top of ADR 0170 § A), pure. A member owes at most one
 * feedback: the one of his last shift whose feedback has opened, on an account whose pay reads the sales. A later
 * shift's opening makes an older one expire: it is counted as missing, and never caught up. « Je prends mon poste »
 * asks for the one owed first.
 */

/** A member's last shift whose feedback has opened (not cancelled), as the store reads it. */
export interface LastOpenedShift {
  readonly id: ShiftId;
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly memberId: TeamMemberId;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** Its account's pay reads the platform's sales for its period (`detected`): it takes the feedback. */
  readonly takesFeedback: boolean;
  readonly hasFeedback: boolean;
}

/** The feedback he owes, or null: his last opened shift, when it takes one and has none. */
export function feedbackOwed(last: LastOpenedShift | null): LastOpenedShift | null {
  return last !== null && last.takesFeedback && !last.hasFeedback ? last : null;
}

/** A feedback is made only for his last opened shift; any older one has expired. */
export function assertFeedbackNotExpired(shiftId: ShiftId, last: LastOpenedShift | null): void {
  if (last?.id !== shiftId) throw new ShiftFeedbackExpired();
}

/** « Je prends mon poste » on `shiftId` waits for the feedback he owes on another shift. */
export function assertNoFeedbackOwed(shiftId: ShiftId, owed: LastOpenedShift | null): void {
  if (owed !== null && owed.id !== shiftId) throw new ShiftCheckInFeedbackDue(owed.id);
}

/**
 * What the feedback may say against its shift's figures (ADR 0170 §§ 1 and 2): a fan linked is one of the shift's,
 * and the closed question is answered only when it was asked.
 */
export function assertFeedbackFits(
  sent: { readonly signals: readonly ReportSignal[]; readonly draftReason: DraftReason | null },
  shift: {
    readonly drafts: ShiftDraftCounts;
    readonly fans: readonly { readonly conversationId: ConversationId }[];
  },
): void {
  const fans = new Set<string>(shift.fans.map((fan) => fan.conversationId));
  if (sent.signals.some((signal) => signal.conversationId !== null && !fans.has(signal.conversationId))) {
    throw new ShiftFeedbackFanConflict();
  }
  if (sent.draftReason !== null && !draftReasonAsked(shift.drafts)) throw new ShiftFeedbackReasonConflict();
}

/**
 * The shifts of a period counted missing: no feedback, taking one, and not their member's last opened shift (that one
 * is still owed, not missing).
 */
export function missingFeedbacks<T extends { readonly shiftId: ShiftId; readonly memberId: TeamMemberId }>(
  withoutFeedback: readonly T[],
  lastOf: ReadonlyMap<TeamMemberId, ShiftId>,
): T[] {
  return withoutFeedback.filter((shift) => lastOf.get(shift.memberId) !== shift.shiftId);
}
