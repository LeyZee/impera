import { DEPARTURE_LATE_MINUTES } from '@impera/contracts';

/** Scheduled, and its hour passed more than `DEPARTURE_LATE_MINUTES` ago (ADR 0166 § 2): said in red to the owners. */
export function isLateDeparture(
  departure: { readonly endsAt: Date; readonly cancelledAt: Date | null; readonly appliedAt: Date | null },
  now: Date,
): boolean {
  return (
    departure.cancelledAt === null &&
    departure.appliedAt === null &&
    now.getTime() - departure.endsAt.getTime() > DEPARTURE_LATE_MINUTES * 60_000
  );
}

/**
 * Who applies a departure at its hour (ADR 0166 § 2): the owner who set it while he still is one, otherwise the first
 * owner in office, so that a departure never waits on an owner who left. `null` when there is no owner at all.
 */
export function departureApplier<T extends string>(scheduledBy: T, owners: readonly T[]): T | null {
  return owners.includes(scheduledBy) ? scheduledBy : (owners[0] ?? null);
}
