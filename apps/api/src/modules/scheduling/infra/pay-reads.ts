import {
  CurrencySchema,
  PayPeriodSchema,
  PlatformAccountIdSchema,
  ShiftReportIdSchema,
  TeamMemberIdSchema,
  type Currency,
  type PayPeriod,
  type PlatformAccountId,
  type ShiftReportId,
  type TeamMemberId,
} from '@nirvana/contracts';
import { enterCreator, sql, type Transaction } from '@nirvana/db';
import { z } from 'zod';

/**
 * What pay reads of the planning (EQ-04, ADR 0023 § Paie), in pay's own transaction: the module owns the reports and
 * the accounts' rules, pay gets these functions through the module's `index.ts`, never the tables.
 */

/** A validated report as pay counts it: its amount, and the rules of its account for the period it was made in. */
export interface ValidatedReportForPay {
  readonly id: ShiftReportId;
  readonly memberId: TeamMemberId;
  readonly platformAccountId: PlatformAccountId;
  /** The period it was made for, which keeps its rules wherever pay counts it. */
  readonly period: PayPeriod;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly vatBps: number;
  readonly platformFeeBps: number;
}

const RowSchema = z.object({
  id: ShiftReportIdSchema,
  member_id: TeamMemberIdSchema,
  platform_account_id: PlatformAccountIdSchema,
  period: PayPeriodSchema,
  amount_minor: z.number().int(),
  currency: CurrencySchema,
  vat_bps: z.number().int().nullable(),
  platform_fee_bps: z.number().int().nullable(),
});

/** The validated reports made for `upTo` or an earlier period that the transaction reads. */
async function validatedReports(tx: Transaction, upTo: PayPeriod): Promise<ValidatedReportForPay[]> {
  const result = await tx.execute(sql`
    select r.id, r.member_id, r.platform_account_id, r.period::text as period, r.amount_minor, r.currency,
      rules.vat_bps, rules.platform_fee_bps
    from shift_reports r
    left join lateral (
      select a.vat_bps, a.platform_fee_bps from account_pay_rules a
      where a.platform_account_id = r.platform_account_id and a.from_period <= r.period
      order by a.from_period desc limit 1
    ) rules on true
    where r.status = 'validated' and r.period <= ${upTo}
    order by r.id`);
  return result.rows.map((raw) => {
    const row = RowSchema.parse(raw);
    if (row.vat_bps === null || row.platform_fee_bps === null) {
      throw new Error(`Validated report ${row.id} has no pay rules for its period`);
    }
    return {
      id: row.id,
      memberId: row.member_id,
      platformAccountId: row.platform_account_id,
      period: row.period,
      amountMinor: row.amount_minor,
      currency: row.currency,
      vatBps: row.vat_bps,
      platformFeeBps: row.platform_fee_bps,
    };
  });
}

/**
 * Every validated report made for `upTo` or an earlier period, on every creator: pay's job runs on the admin
 * connection, a read bounded to that job (ADR 0023 § Paie). A report was validated only under its period's rules
 * (`assertDeclarable`), so a report without them is a broken database, never a case of pay.
 */
export function validatedReportsUnscoped(tx: Transaction, upTo: PayPeriod): Promise<ValidatedReportForPay[]> {
  return validatedReports(tx, upTo);
}

/** One creator's validated reports, as the validation of a statement reads them. */
export interface CreatorReportsForPay {
  readonly creatorId: string;
  readonly reports: readonly ValidatedReportForPay[];
}

/**
 * The same reports as the member of the transaction may read them, creator by creator (`enterCreator` on the list the
 * caller checked): the validation that closes a period runs as its member, so that the policies keep the four eyes
 * (ADR 0032). The transaction is left in the last creator of the list.
 */
export async function validatedReportsScoped(
  tx: Transaction,
  creatorIds: readonly string[],
  upTo: PayPeriod,
): Promise<CreatorReportsForPay[]> {
  const read: CreatorReportsForPay[] = [];
  for (const creatorId of creatorIds) {
    await enterCreator(tx, creatorId, creatorIds);
    read.push({ creatorId, reports: await validatedReports(tx, upTo) });
  }
  return read;
}

/**
 * How many reports made for a period after `after` (any, when `null`) up to `upTo` wait for review, sent and neither
 * validated nor sent back, creator by creator as `validatedReportsScoped`: a closing would send them to the next
 * period unseen (ADR 0032).
 */
export async function reportsAwaitingReviewScoped(
  tx: Transaction,
  creatorIds: readonly string[],
  after: PayPeriod | null,
  upTo: PayPeriod,
): Promise<number> {
  let waiting = 0;
  for (const creatorId of creatorIds) {
    await enterCreator(tx, creatorId, creatorIds);
    const result = await tx.execute(sql`
      select count(*)::int as count from shift_reports
      where status = 'submitted' and period <= ${upTo} and (${after}::date is null or period > ${after}::date)`);
    waiting += z.object({ count: z.number().int() }).parse(result.rows[0]).count;
  }
  return waiting;
}

/**
 * Pay's `payroll.recalculate` for a period, in the transaction that validates a report: the `payroll` module's own
 * function, which the composition root gives the planning (EQ-04), so that the job keeps one key and one number of
 * attempts.
 */
export type EnqueuePayRecalculation = (tx: Transaction, period: PayPeriod) => Promise<void>;
