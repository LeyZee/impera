import type {
  AccountPayRules,
  CreatorSummary,
  LeaveRequest,
  PlanningAccount,
  PlanningMember,
  Shift,
  ShiftReport,
  ShiftSwapRequest,
} from '@nirvana/contracts';

import type {
  NamedMember,
  StoredAccount,
  StoredLeaveRequest,
  StoredPayRules,
  StoredShift,
  StoredShiftReport,
  StoredSwap,
} from '../domain/ports';
import { canReview, type Reader } from '../domain/reports';

/** From what the stores read to what the contract sends: instants as ISO strings, members by name and colour only. */

export const toShiftDto = (shift: StoredShift): Shift => ({
  id: shift.id,
  creatorId: shift.creatorId,
  platformAccountId: shift.platformAccountId,
  memberId: shift.memberId,
  startsAt: shift.startsAt.toISOString(),
  endsAt: shift.endsAt.toISOString(),
  templateId: shift.templateId,
  stoppedAt: shift.stoppedAt?.toISOString() ?? null,
});

export const toPlanningMember = (member: NamedMember): PlanningMember => ({
  id: member.id,
  displayName: member.displayName,
  color: member.color,
});

export const toPlanningAccount = (
  account: StoredAccount,
  creatorNames: ReadonlyMap<string, CreatorSummary>,
): PlanningAccount => ({ ...account, creatorName: creatorNames.get(account.creatorId)?.displayName ?? '—' });

const isoOrNull = (at: Date | null): string | null => at?.toISOString() ?? null;

export const toLeaveRequestDto = (leave: StoredLeaveRequest): LeaveRequest => ({
  id: leave.id,
  memberId: leave.memberId,
  firstDay: leave.firstDay,
  lastDay: leave.lastDay,
  timeZone: leave.timeZone,
  startsAt: leave.startsAt.toISOString(),
  endsAt: leave.endsAt.toISOString(),
  note: leave.note,
  status: leave.status,
  decidedAt: isoOrNull(leave.decidedAt),
  cancelledAt: isoOrNull(leave.cancelledAt),
  decisionNote: leave.decisionNote,
  createdAt: leave.createdAt.toISOString(),
});

export const toSwapDto = (swap: StoredSwap): ShiftSwapRequest => ({
  id: swap.id,
  requesterId: swap.requesterId,
  shiftId: swap.shiftId,
  creatorId: swap.creatorId,
  shiftStartsAt: swap.shiftStartsAt.toISOString(),
  shiftEndsAt: swap.shiftEndsAt.toISOString(),
  targetMemberId: swap.targetMemberId,
  targetShiftId: swap.targetShiftId,
  targetCreatorId: swap.targetCreatorId,
  targetShiftStartsAt: isoOrNull(swap.targetShiftStartsAt),
  targetShiftEndsAt: isoOrNull(swap.targetShiftEndsAt),
  message: swap.message,
  status: swap.status,
  resolvedAt: isoOrNull(swap.resolvedAt),
  revertedAt: isoOrNull(swap.revertedAt),
  withdrawnByAgency: swap.withdrawnByAgency,
  createdAt: swap.createdAt.toISOString(),
});

/** A report as its reader sees it: `canReview` is said for them, from the transaction that read it. */
export const toShiftReportDto = (report: StoredShiftReport, reader: Reader): ShiftReport => ({
  id: report.id,
  shiftId: report.shiftId,
  creatorId: report.creatorId,
  platformAccountId: report.platformAccountId,
  memberId: report.memberId,
  period: report.period,
  correctsId: report.correctsId,
  amount: { amountMinor: report.amountMinor, currency: report.currency },
  comment: report.comment,
  incident: report.incident,
  status: report.status,
  version: report.version,
  byAgency: report.byAgency,
  canReview: canReview(report, reader),
  submittedAt: report.submittedAt.toISOString(),
  reviewedAt: isoOrNull(report.reviewedAt),
  reviewNote: report.reviewNote,
  createdAt: report.createdAt.toISOString(),
});

export const toPayRulesDto = (rules: StoredPayRules): AccountPayRules => ({
  ...rules,
  createdAt: rules.createdAt.toISOString(),
});
