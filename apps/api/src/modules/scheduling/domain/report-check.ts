import {
  SHIFT_REPORT_CHECK_LATE_MINUTES,
  SHIFT_REPORT_EXPLAIN_HOURS,
  type ReportGapThreshold,
  type ShiftReportCheck,
} from '@impera/contracts';

import { ShiftReportGap } from './errors';
import { accessWindow, type ShiftTimes } from './shifts';
import { addMinutes } from './time';

/**
 * A declared report against what the platform read during its shift (ADR 0073), pure: the planning decides the gap,
 * the connectors only read the sales (`ShiftSalesRead`). Reveal is right (ADR 0018): nothing here ever changes an
 * amount, it says whether the report validates by itself, waits for its member, or follows the human validation.
 */

/** What the platform read for the shift, as the connectors answer it (`salesFeedReadsForReports.shiftSales`). */
export type ShiftSalesRead =
  | { readonly feed: 'none' | 'off' | 'model_unlinked' | 'chatter_unlinked' }
  | { readonly feed: 'read'; readonly grossInclVatMinor: number; readonly caughtUpAt: Date | null };

/** The instants the sales are read over: the shift's access window (ADR 0025), `[from, to)`. */
export function checkWindow(shift: ShiftTimes, marginMinutes: number): { from: Date; to: Date } {
  const window = accessWindow(shift, marginMinutes);
  return { from: window.startsAt, to: window.endsAt };
}

/** From when the comparison may be complete: the window's end plus the quarter of an hour for late lines (§ 2). */
export function completeFrom(shift: ShiftTimes, marginMinutes: number): Date {
  return addMinutes(checkWindow(shift, marginMinutes).to, SHIFT_REPORT_CHECK_LATE_MINUTES);
}

/** Until when a report out of the threshold waits for its member (§ 5): its shift's end plus 48 hours. */
export function explainBy(shift: ShiftTimes): Date {
  return addMinutes(shift.endsAt, SHIFT_REPORT_EXPLAIN_HOURS * 60);
}

/**
 * Whether a gap is within the threshold (§ 3): at most `bps` of what was read, or at most `minor`. In integers, so
 * that a gap exactly at 1 % is within it, never lost to a rounding.
 */
export function withinThreshold(gapMinor: number, readMinor: number, threshold: ReportGapThreshold): boolean {
  const gap = Math.abs(gapMinor);
  return gap <= threshold.minor || gap * 10_000 <= Math.max(readMinor, 0) * threshold.bps;
}

/**
 * The check of a report declaring `declaredMinor` (ADR 0073 § 2, § 7): `null` when no register is read for its
 * account; `unavailable` with its reason; `provisional` until the window is over plus a quarter of an hour and a read
 * reached the end of the register after that; `complete` then. `within` is in the threshold and not above the
 * platform (§ 4); anything else is a `gap`, even a cent above (§ 5).
 */
export function reportCheck(input: {
  readonly declaredMinor: number;
  readonly sales: ShiftSalesRead;
  readonly shift: ShiftTimes;
  readonly marginMinutes: number;
  readonly threshold: ReportGapThreshold;
  readonly now: Date;
}): ShiftReportCheck | null {
  const { sales } = input;
  switch (sales.feed) {
    case 'none':
      return null;
    case 'off':
      return { state: 'unavailable', reason: 'feed_off' };
    case 'model_unlinked':
    case 'chatter_unlinked':
      return { state: 'unavailable', reason: sales.feed };
    case 'read': {
      const from = completeFrom(input.shift, input.marginMinutes);
      const complete =
        input.now.getTime() >= from.getTime() &&
        sales.caughtUpAt !== null &&
        sales.caughtUpAt.getTime() >= from.getTime();
      if (!complete) return { state: 'provisional', readMinor: sales.grossInclVatMinor };
      const gapMinor = input.declaredMinor - sales.grossInclVatMinor;
      const within = gapMinor <= 0 && withinThreshold(gapMinor, sales.grossInclVatMinor, input.threshold);
      return {
        state: 'complete',
        readMinor: sales.grossInclVatMinor,
        gapMinor,
        verdict: within ? 'within' : 'gap',
        explainBy: within ? null : explainBy(input.shift).toISOString(),
      };
    }
  }
}

/** Whether the automatic check validates the report by itself (§ 4): a complete check, within the threshold. */
export function validatesByItself(check: ShiftReportCheck | null): boolean {
  return check?.state === 'complete' && check.verdict === 'within';
}

/**
 * A person's validation of a report (§ 5): refused while its complete check says `gap` and its member has neither
 * explained it nor let `explainBy` pass. Correcting the amount is a new version, read again; so is an explanation.
 */
export function assertGapAnswered(
  check: ShiftReportCheck | null,
  explanation: string | null,
  now: Date,
): void {
  if (check?.state !== 'complete' || check.verdict !== 'gap' || explanation !== null) return;
  if (check.explainBy === null || now.getTime() >= Date.parse(check.explainBy)) return;
  throw new ShiftReportGap(check.explainBy);
}
