import {
  REPORT_GAP_THRESHOLD_DEFAULT,
  ReportGapThresholdSchema,
  ShiftReportCheckSchema,
  type Currency,
  type PlatformAccountId,
  type ReportGapThreshold,
  type ShiftReportCheck,
  type TeamMemberId,
} from '@impera/contracts';
import { schema, type Transaction } from '@impera/db';
import { z } from 'zod';

import type { StoredShift } from '../domain/ports';
import { checkWindow, reportCheck, type ShiftSalesRead } from '../domain/report-check';
import { DEFAULT_SCHEDULING_SETTINGS } from '../domain/shifts';

/**
 * What the platform read for a shift: the `connectors` module's `salesFeedReadsForReports.shiftSales`, given by the
 * composition root and read in the caller's transaction (ADR 0073, Conséquences): under the reader's policies for a
 * screen, as the admin role for the job. The planning never opens the register itself.
 */
export type ShiftSalesReader = (
  tx: Transaction,
  query: {
    readonly platformAccountId: PlatformAccountId;
    readonly memberId: TeamMemberId;
    readonly currency: Currency;
    readonly from: Date;
    readonly to: Date;
    readonly now: Date;
  },
) => Promise<ShiftSalesRead>;

/** What a check reads of the agency's settings: the access margin (ADR 0025) and the threshold (ADR 0073 § 3). */
export interface CheckSettings {
  readonly marginMinutes: number;
  readonly threshold: ReportGapThreshold;
}

/** The settings as `tx` reads them, the module's defaults where nothing is saved. Every team scope reads them. */
export async function checkSettingsIn(tx: Transaction): Promise<CheckSettings> {
  const [row] = await tx
    .select({
      marginMinutes: schema.schedulingSettings.accessMarginMinutes,
      bps: schema.schedulingSettings.reportGapBps,
      minor: schema.schedulingSettings.reportGapMinor,
    })
    .from(schema.schedulingSettings);
  return {
    marginMinutes: row?.marginMinutes ?? DEFAULT_SCHEDULING_SETTINGS.accessMarginMinutes,
    threshold: row === undefined ? REPORT_GAP_THRESHOLD_DEFAULT : { bps: row.bps, minor: row.minor },
  };
}

/** What a validation keeps of the platform (`shift_reports.review_check`), read back through Zod. */
const ReviewCheckSchema = z.object({
  check: ShiftReportCheckSchema,
  threshold: ReportGapThresholdSchema,
});

/** A report as a check reads it: its stored row, before the check is attached. */
export interface ReportToCheck {
  readonly platformAccountId: PlatformAccountId;
  readonly memberId: TeamMemberId;
  readonly correctsId: string | null;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly status: 'submitted' | 'validated' | 'rejected';
  readonly reviewCheck: unknown;
}

/**
 * A report's check (ADR 0073): `null` for a correction; what its validation kept once validated; read now otherwise,
 * against its shift. In `tx`, which the reader's policies or the admin role govern.
 */
export async function checkOf(
  tx: Transaction,
  report: ReportToCheck,
  shift: StoredShift | undefined,
  read: ShiftSalesReader,
  settings: CheckSettings,
  now: Date,
): Promise<ShiftReportCheck | null> {
  if (report.correctsId !== null) return null;
  if (report.status === 'validated') {
    return report.reviewCheck === null ? null : ReviewCheckSchema.parse(report.reviewCheck).check;
  }
  if (shift === undefined) return null;
  const window = checkWindow(shift, settings.marginMinutes);
  const sales = await read(tx, {
    platformAccountId: report.platformAccountId,
    memberId: report.memberId,
    currency: report.currency,
    from: window.from,
    to: window.to,
    now,
  });
  return reportCheck({
    declaredMinor: report.amountMinor,
    sales,
    shift,
    marginMinutes: settings.marginMinutes,
    threshold: settings.threshold,
    now,
  });
}
