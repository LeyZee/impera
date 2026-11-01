import {
  BonusSchema,
  BonusTierSetSchema,
  CarryOverSchema,
  CollectiveGoalSchema,
  CollectiveReachedSchema,
  CommissionStatementIdSchema,
  CommissionStatementStatusSchema,
  DEFAULT_MINIMUM_PAYOUT_MINOR,
  ExchangeRateSchema,
  nextPayoutMinimum,
  PayAdjustmentSchema,
  payPeriodLastDay,
  PayPeriodSchema,
  payoutMinimumFor,
  PayoutMinimumSchema,
  PenaltySchema,
  ShiftReportIdSchema,
  TeamMemberIdSchema,
  type Bonus,
  type BonusTierSet,
  type CollectiveGoal,
  type ExchangeRate,
  type PayAdjustment,
  type PayPeriod,
  type PayoutMinimum,
  type PayrollSettings,
  type Penalty,
  type ShiftReportId,
} from '@nirvana/contracts';
import { eq, schema, sql, type Transaction } from '@nirvana/db';
import { z } from 'zod';

import type { CreatorReports } from '../domain/ports';
import type { MemberForPay, PeriodSnapshot, ReportForPay } from '../domain/recalculation';

const {
  bonusTierSets,
  bonuses,
  carryOvers,
  collectiveGoals,
  commissionStatements,
  exchangeRates,
  payAdjustments,
  payPeriodClosings,
  payPeriodReports,
  payoutMinimums,
  payrollSettings,
  penalties,
} = schema;

/**
 * What pay reads of the other modules, in its own transaction (given by the composition root from their `index.ts`):
 * the planning's validated reports, on every creator for the job (admin connection) or creator by creator as the
 * validating member reads them, the reports still waiting for review, the agency's zone, the team's members and rates,
 * and the creators that exist.
 */
export interface PayInputReads {
  readonly validatedReportsUnscoped: (tx: Transaction, upTo: PayPeriod) => Promise<readonly ReportForPay[]>;
  readonly validatedReportsScoped: (
    tx: Transaction,
    creatorIds: readonly string[],
    upTo: PayPeriod,
  ) => Promise<readonly CreatorReports[]>;
  readonly reportsAwaitingReviewScoped: (
    tx: Transaction,
    creatorIds: readonly string[],
    after: PayPeriod | null,
    upTo: PayPeriod,
  ) => Promise<number>;
  readonly agencyTimeZone: (tx: Transaction) => Promise<string>;
  readonly members: (tx: Transaction, day: string) => Promise<readonly MemberForPay[]>;
  readonly creatorIds: () => Promise<readonly string[]>;
}

const iso = (at: Date): string => at.toISOString();

const cancellationOf = (row: { cancelledAt: Date | null; cancelledBy: string | null }) =>
  row.cancelledAt === null ? null : { cancelledAt: iso(row.cancelledAt), cancelledBy: row.cancelledBy };

export const bonusOfRow = (row: typeof bonuses.$inferSelect): Bonus =>
  BonusSchema.parse({ ...row, createdAt: iso(row.createdAt), cancellation: cancellationOf(row) });

export const penaltyOfRow = (row: typeof penalties.$inferSelect): Penalty =>
  PenaltySchema.parse({
    ...row,
    amount:
      row.kind === 'fixed'
        ? { kind: 'fixed', amountMinor: row.amountMinor }
        : { kind: 'percent', bps: row.bps },
    createdAt: iso(row.createdAt),
    cancellation:
      row.cancelledAt === null
        ? null
        : {
            cancelledAt: iso(row.cancelledAt),
            cancelledBy: row.cancelledBy,
            cancelledFrom: row.cancelledFrom,
          },
  });

export const adjustmentOfRow = (row: typeof payAdjustments.$inferSelect): PayAdjustment =>
  PayAdjustmentSchema.parse({ ...row, createdAt: iso(row.createdAt) });

export const bonusTierSetOfRow = (row: typeof bonusTierSets.$inferSelect): BonusTierSet =>
  BonusTierSetSchema.parse({ ...row, createdAt: iso(row.createdAt) });

export const collectiveGoalOfRow = (row: typeof collectiveGoals.$inferSelect): CollectiveGoal =>
  CollectiveGoalSchema.parse({ ...row, createdAt: iso(row.createdAt) });

export const exchangeRateOfRow = (row: typeof exchangeRates.$inferSelect): ExchangeRate =>
  ExchangeRateSchema.parse({ ...row, fetchedAt: iso(row.fetchedAt) });

export const payoutMinimumOfRow = (row: typeof payoutMinimums.$inferSelect): PayoutMinimum =>
  PayoutMinimumSchema.parse({ ...row, createdAt: iso(row.createdAt) });

/**
 * The settings as they stand for `period` (PAIE-22, PAIE-32): the dated minimum in force, else the single one of
 * `payroll_settings`, else the default; the first change set after `period`; the payout delay announced. Read under
 * the reader's policies: every member reads them.
 */
export async function settingsFor(tx: Transaction, period: PayPeriod): Promise<PayrollSettings> {
  const [row] = await tx.select().from(payrollSettings);
  const dated = (await tx.select().from(payoutMinimums)).map(payoutMinimumOfRow);
  const next = nextPayoutMinimum(dated, period);
  return {
    minimumPayoutMinor:
      payoutMinimumFor(dated, period)?.minimumPayoutMinor ??
      row?.minimumPayoutMinor ??
      DEFAULT_MINIMUM_PAYOUT_MINOR,
    nextMinimum:
      next === null ? null : { fromPeriod: next.fromPeriod, minimumPayoutMinor: next.minimumPayoutMinor },
    payoutDelayBusinessDays: row?.payoutDelayBusinessDays ?? null,
  };
}

/**
 * The penalties whose periods span `period`, as the engine and the list of entries read them: which of them count
 * there, or show struck through, is `penaltyCovers` and `penaltyApplies`, never this condition.
 */
export const penaltiesSpanning = (period: PayPeriod): ReturnType<typeof sql> =>
  sql`${penalties.fromPeriod} <= ${period} and ${penalties.toPeriod} >= ${period}`;

/** The registry's period of each report among `ids` a closing counted. */
export async function registeredAmong(
  tx: Transaction,
  ids: readonly ShiftReportId[],
): Promise<Map<ShiftReportId, PayPeriod>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: payPeriodReports.shiftReportId, period: payPeriodReports.period })
    .from(payPeriodReports)
    .where(sql`${payPeriodReports.shiftReportId} = any(${sql.param([...ids])}::uuid[])`);
  return new Map(rows.map((row) => [ShiftReportIdSchema.parse(row.id), PayPeriodSchema.parse(row.period)]));
}

export async function closingsSpan(
  tx: Transaction,
): Promise<{ first: PayPeriod | null; last: PayPeriod | null }> {
  const [span] = await tx
    .select({
      first: sql<string | null>`min(${payPeriodClosings.period})::text`,
      last: sql<string | null>`max(${payPeriodClosings.period})::text`,
    })
    .from(payPeriodClosings);
  return {
    first: span?.first == null ? null : PayPeriodSchema.parse(span.first),
    last: span?.last == null ? null : PayPeriodSchema.parse(span.last),
  };
}

/**
 * Everything `period`'s statements are made of, in the caller's transaction, with the validated reports made for it or
 * an earlier one that the caller read (`reports`): the job on every creator, a validation creator by creator.
 */
export async function readSnapshot(
  tx: Transaction,
  reads: PayInputReads,
  period: PayPeriod,
  reports: readonly ReportForPay[],
): Promise<PeriodSnapshot> {
  const lastDay = payPeriodLastDay(period);
  const [closing] = await tx.select().from(payPeriodClosings).where(eq(payPeriodClosings.period, period));
  const span = await closingsSpan(tx);
  const registered = await registeredAmong(
    tx,
    reports.map((report) => report.id),
  );

  const bonusRows = await tx.select().from(bonuses).where(eq(bonuses.period, period));
  const penaltyRows = await tx.select().from(penalties).where(penaltiesSpanning(period));
  const carryRows = await tx.select().from(carryOvers).where(eq(carryOvers.toPeriod, period));
  const adjustmentRows = await tx.select().from(payAdjustments).where(eq(payAdjustments.period, period));
  const tierRows = await tx
    .select()
    .from(bonusTierSets)
    .where(sql`${bonusTierSets.fromPeriod} <= ${period}`);
  const goalRows = await tx.select().from(collectiveGoals).where(eq(collectiveGoals.period, period));
  const settings = await settingsFor(tx, period);
  const rateRows = await tx
    .selectDistinctOn([exchangeRates.currency])
    .from(exchangeRates)
    .where(sql`${exchangeRates.day} <= ${lastDay}::date`)
    .orderBy(exchangeRates.currency, sql`${exchangeRates.day} desc`);
  const statementRows = await tx
    .select({
      id: commissionStatements.id,
      memberId: commissionStatements.memberId,
      status: commissionStatements.status,
      revision: commissionStatements.revision,
      inputsHash: commissionStatements.inputsHash,
    })
    .from(commissionStatements)
    .where(eq(commissionStatements.period, period));

  return {
    period,
    closing:
      closing === undefined
        ? null
        : {
            teamNetMinor: closing.teamNetMinor,
            collective: CollectiveReachedSchema.nullable().parse(closing.collective),
            exchangeRates: z.array(ExchangeRateSchema).parse(closing.exchangeRates),
          },
    firstClosed: span.first,
    lastClosed: span.last,
    reports,
    registered,
    members: await reads.members(tx, lastDay),
    bonuses: bonusRows.map(bonusOfRow),
    penalties: penaltyRows.map(penaltyOfRow),
    carryOvers: carryRows.map((row) => CarryOverSchema.parse({ ...row, createdAt: iso(row.createdAt) })),
    adjustments: adjustmentRows.map(adjustmentOfRow),
    bonusTierSets: tierRows.map(bonusTierSetOfRow),
    collectiveGoals: goalRows.map(collectiveGoalOfRow),
    minimumPayoutMinor: settings.minimumPayoutMinor,
    latestRates: rateRows.map(exchangeRateOfRow),
    statements: statementRows.map((row) => ({
      id: CommissionStatementIdSchema.parse(row.id),
      memberId: TeamMemberIdSchema.parse(row.memberId),
      status: CommissionStatementStatusSchema.parse(row.status),
      revision: row.revision,
      inputsHash: row.inputsHash,
    })),
  };
}
