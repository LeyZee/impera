import type {
  CreatorAbsence,
  CreatorStop,
  CreatorId,
  CreatorLimits,
  NewAbsenceBody,
} from '@impera/contracts';

/**
 * What she tells the agency herself (Charles, 21/11): her absences not over yet, the nearest first, and what she no
 * longer does, the latest first. Taken back ones are never shown. Pure: the store reads rows, this decides.
 */

export interface AbsenceRow extends CreatorAbsence {
  readonly cancelled: boolean;
}

export interface StopRow extends CreatorStop {
  readonly withdrawn: boolean;
}

export function limitsOf(
  creatorId: CreatorId,
  today: string,
  absences: readonly AbsenceRow[],
  stops: readonly StopRow[],
): CreatorLimits {
  return {
    creatorId,
    today,
    absences: absences
      .filter((a) => !a.cancelled && a.endsOn >= today)
      .toSorted((a, b) => a.startsOn.localeCompare(b.startsOn) || a.endsOn.localeCompare(b.endsOn))
      .map((a) => ({
        id: a.id,
        startsOn: a.startsOn,
        endsOn: a.endsOn,
        note: a.note,
        createdAt: a.createdAt,
      })),
    stops: stops
      .filter((s) => !s.withdrawn)
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({ id: s.id, what: s.what, createdAt: s.createdAt })),
  };
}

/** An absence is told ahead, or on the day: never one already begun before today. */
export function canTellAbsence(absence: Pick<NewAbsenceBody, 'startsOn'>, today: string): boolean {
  return absence.startsOn >= today;
}
