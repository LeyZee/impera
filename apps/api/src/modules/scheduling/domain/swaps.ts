import type { ShiftSwapStatus, TeamScope } from '@nirvana/contracts';

import { ShiftNotFound, ShiftStarted, ShiftSwapAnswered, ShiftSwapNotYours, ShiftSwapSelf } from './errors';

/** Swap rules (ADR 0031, contract `scheduling.ts`), pure. */

/** A shift as a swap sees it now. */
export interface SwapShiftNow {
  readonly memberId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly cancelled: boolean;
}

/** What the swap noted of a shift when it was proposed: whose it was, and its hours. */
export interface SwapShiftNoted {
  readonly memberId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** A shift a member offers or asks back: theirs, not cancelled, not started. */
export function assertOffered(
  shift: SwapShiftNow | null,
  memberId: string,
  now: Date,
): asserts shift is SwapShiftNow {
  if (shift === null || shift.cancelled || shift.memberId !== memberId) throw new ShiftNotFound();
  if (shift.startsAt.getTime() <= now.getTime()) throw new ShiftStarted();
}

export function assertColleague(requesterId: string, targetMemberId: string): void {
  if (requesterId === targetMemberId) throw new ShiftSwapSelf();
}

/**
 * The shift is as the swap noted it, and still ahead: same member, same hours, neither cancelled nor started.
 * Otherwise the swap has lapsed: what the colleague was asked is no longer what would happen.
 */
export function stillAsNoted(shift: SwapShiftNow | null, noted: SwapShiftNoted, now: Date): boolean {
  return (
    shift !== null &&
    !shift.cancelled &&
    shift.memberId === noted.memberId &&
    shift.startsAt.getTime() === noted.startsAt.getTime() &&
    shift.endsAt.getTime() === noted.endsAt.getTime() &&
    shift.startsAt.getTime() > now.getTime()
  );
}

/** Only the colleague asked answers, and only a proposed swap. */
export function assertAnswers(swap: { readonly status: ShiftSwapStatus; readonly asked: boolean }): void {
  if (!swap.asked) throw new ShiftSwapNotYours();
  if (swap.status !== 'proposed') throw new ShiftSwapAnswered();
}

/**
 * What a `DELETE` does: the requester, the owner or an active manager withdraws a proposed swap; the owner or an
 * active manager reverts an accepted one. The colleague asked declines, never deletes.
 */
export function swapEnding(
  scope: TeamScope,
  swap: { readonly status: ShiftSwapStatus; readonly requested: boolean },
): 'withdraw' | 'revert' {
  const plans = scope === 'owner' || scope === 'agency';
  if (swap.status === 'proposed' && (swap.requested || plans)) return 'withdraw';
  if (swap.status === 'accepted' && plans) return 'revert';
  if (!swap.requested && !plans) throw new ShiftSwapNotYours();
  throw new ShiftSwapAnswered();
}
