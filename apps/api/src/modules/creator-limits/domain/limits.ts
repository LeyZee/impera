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

/**
 * Whether she is away on `today` in her zone (Charles, 26/11: the AI chats, but promises nothing that needs her), and
 * until which day included: an absence that covers today, carried through the ones that follow it without a day
 * between. `null` when she is here. Reads what `limitsOf` kept: taken back absences are already gone.
 */
export function absenceOn(
  limits: Pick<CreatorLimits, 'today' | 'absences'>,
): { readonly until: string } | null {
  const ordered = limits.absences.toSorted((a, b) => a.startsOn.localeCompare(b.startsOn));
  let until: string | null = null;
  for (const absence of ordered) {
    if (until === null) {
      if (absence.startsOn <= limits.today && absence.endsOn >= limits.today) until = absence.endsOn;
      continue;
    }
    if (absence.startsOn > nextDay(until)) break;
    if (absence.endsOn > until) until = absence.endsOn;
  }
  return until === null ? null : { until };
}

/** The calendar day after `day` (YYYY-MM-DD), by the UTC calendar: no clock, no zone. */
function nextDay(day: string): string {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
