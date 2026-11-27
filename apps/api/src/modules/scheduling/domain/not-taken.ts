import { holdsShift, type WorkingMember } from './shifts';

/**
 * « Chatteur pas là » (ADR 0094 § 1, lot b), pure. How far back each run looks for a shift that became due: the job runs
 * every five minutes, so a run that failed or a worker restarted loses nothing, and a shift seen twice is published once
 * (unique index on the shift).
 */
export const NOT_TAKEN_LOOKBACK_MS = 30 * 60_000;

export interface NotTakenCandidate {
  readonly id: string;
  readonly creatorId: string;
  readonly platformAccountId: string;
  readonly memberId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly stoppedAt: Date | null;
  readonly checkedInAt: Date | null;
}

/**
 * The shifts whose member has not taken them (`checkedInAt` null, « Je prends mon poste », EQ-12) the agency's delay
 * after their start: due (start + delay) in the last `NOT_TAKEN_LOOKBACK_MS`, at or before `now`, and not over (not
 * ended, not stopped). Only a shift its member holds (active, still on her list, `holdsShift`): one of a member away or
 * gone is the planning's « à pourvoir », told by « compte sans personne », never as his absence. `delayMinutes` is the
 * agency's setting; there is no default.
 */
export function notTakenShifts<T extends NotTakenCandidate>(input: {
  readonly shifts: readonly T[];
  readonly members: ReadonlyMap<string, Pick<WorkingMember, 'status' | 'creatorIds'>>;
  readonly delayMinutes: number;
  readonly now: Date;
}): T[] {
  const now = input.now.getTime();
  const delay = input.delayMinutes * 60_000;
  return input.shifts.filter((shift) => {
    const due = shift.startsAt.getTime() + delay;
    return (
      shift.checkedInAt === null &&
      shift.stoppedAt === null &&
      due <= now &&
      due > now - NOT_TAKEN_LOOKBACK_MS &&
      now < shift.endsAt.getTime() &&
      holdsShift(input.members.get(shift.memberId), shift)
    );
  });
}
