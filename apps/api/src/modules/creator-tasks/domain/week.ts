import { addDays } from '../../scheduling/pure';

/**
 * How long after a shooting day its lines may still be ticked or taken back (ADR 0042 § 8, ADR 0140 § 24): two days,
 * her days. Ahead of it, always: she may shoot early.
 */
const SHOOT_ITEM_LATE_DAYS = 2;

/** Whether a line of the shooting day `day` may still change on her `today`. */
export const shootItemTimely = (day: string, today: string): boolean =>
  today <= addDays(day, SHOOT_ITEM_LATE_DAYS);

/** A shooting day is done when every one of its lines is (ADR 0140 § 24); a day with no line is never done by them. */
export const shootDayDone = (lines: readonly { readonly done: boolean }[]): boolean =>
  lines.length > 0 && lines.every((line) => line.done);
