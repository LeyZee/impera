import { AgencyRateDayInvalid } from './errors';

/** The agency's percentage of a creator (CR-04, contract `agency-rates.ts`), pure. */

/**
 * A new percentage starts on a day that has not begun in the agency's zone, so that no sale already made changes
 * share (ADR 0042 § 6: never applied backwards). A creator's first alone may start today: nothing was shown as the
 * agency's share before it, her screen said « à régler ». Days are `YYYY-MM-DD`, so their order is the text's.
 */
export function assertRateStart(fromDay: string, today: string, first: boolean): void {
  if (fromDay > today) return;
  if (first && fromDay === today) return;
  throw new AgencyRateDayInvalid();
}
