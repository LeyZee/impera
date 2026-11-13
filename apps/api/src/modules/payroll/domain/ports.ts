import type {
  Bonus,
  BonusId,
  BonusTierSet,
  CollectiveGoal,
  CommissionStatement,
  CommissionStatementId,
  CreateBonusBody,
  CreateBonusTierSetBody,
  CreateCollectiveGoalBody,
  CreatePayoutMinimumBody,
  CreatePaySaleDecisionBody,
  CreatePaySaleSignalBody,
  CreatePenaltyBody,
  DomainError,
  ExchangeRate,
  ExchangeRates,
  ForeignCurrency,
  HeldSales,
  MySales,
  MySalesQuery,
  PayAdjustment,
  PayAdjustmentId,
  PayCommissionStatementBody,
  PayPeriod,
  PayPeriodBlock,
  PageQuery,
  PayPeriodClosing,
  PayPeriodSummary,
  PayPeriodWindow,
  PayrollEntries,
  PayoutBlockReason,
  PayoutMinimum,
  PayrollSettings,
  PaySaleDecision,
  PaySaleSignal,
  SaleGiftCounts,
  SalesToGive,
  Penalty,
  PenaltyId,
  TeamMemberId,
  TeamScope,
  UpdatePayrollSettingsBody,
  UserId,
} from '@impera/contracts';

import type { Actor } from '../../contractors/pure';

import type { PeriodBlockReason } from './period-blocks';
import type { PeriodPlan, PeriodSnapshot, ReportForPay } from './recalculation';

/** One creator's validated reports, as the member who validates reads them in her (ADR 0032). */
export interface CreatorReports {
  readonly creatorId: string;
  readonly reports: readonly ReportForPay[];
}

/**
 * What a recalculation decided: a plan, or the business reason it could not compute the period (a missing rate), with
 * what the period records of it (`reason`, `null` for a refusal it does not record).
 */
export type PeriodDecision =
  | PeriodPlan
  | { readonly kind: 'blocked'; readonly error: DomainError; readonly reason: PeriodBlockReason | null };

interface RecomputedPeriod {
  readonly decision: PeriodDecision;
  readonly closed: boolean;
  readonly lastClosed: PayPeriod | null;
}

/** Where the hourly run starts: the team's last closing, and the earliest period a validated report waits in. */
export interface OpenPeriodFacts {
  readonly current: PayPeriod;
  readonly lastClosed: PayPeriod | null;
  readonly earliestUncounted: PayPeriod | null;
}

/** The jobs' store, on the admin connection: every method is one transaction. */
export interface PayrollJobStore {
  /**
   * Under the lock `payroll.close`: writes pay's period `period` when it is missing, reads what its statements are
   * made of, hands it to `decide`, and writes the drafts a plan gives. In the same transaction, records why the period
   * is blocked when the decision says so (`pay_period_blocks`, keeping `since` while the reason is the same), and
   * lifts it otherwise.
   */
  recomputeUnscoped(
    period: PayPeriod,
    decide: (snapshot: PeriodSnapshot) => PeriodDecision,
  ): Promise<RecomputedPeriod>;
  openPeriodFactsUnscoped(now: Date): Promise<OpenPeriodFacts>;
}

/** The validation of a statement (ADR 0032): one transaction as the member who validates, under both locks. */
export interface PayrollValidationStore {
  /**
   * Closes the statement's period for the team first when it is open, then validates the statement on the closing
   * and writes its carry-over. Throws the module's errors, nothing is written then.
   */
  validate(
    actor: Actor,
    statementId: CommissionStatementId,
    revision: number,
  ): Promise<{ readonly period: PayPeriod }>;
  /** `payroll.recalculate` for `period`, in its own transaction: after a validation refused on a changed statement. */
  enqueueRecalculation(actor: Actor, period: PayPeriod): Promise<void>;
}

/** `CreatePayAdjustmentBodySchema` once parsed: the statement it corrects, `null` for none. */
interface AdjustmentToCreate {
  readonly id: PayAdjustmentId;
  readonly memberId: TeamMemberId;
  readonly amountMinor: number;
  readonly reason: string;
  readonly correctsStatementId: CommissionStatementId | null;
}

/** An entry as a create gives it back: `created` is `false` when the same one was recorded already (a retry). */
interface Recorded<T> {
  readonly value: T;
  readonly created: boolean;
}

/**
 * A member's bonuses, penalties and adjustments, and the payment of a validated statement (EQ-04, ADR 0032), each in
 * one transaction as the member who writes (`withMember`, the policies keep the four eyes). An entry takes the lock
 * (member, period) of its period and of every later one up to today's, and `payroll.close` first while no period is
 * closed yet. Throws the module's errors, nothing is written then.
 */
export interface PayrollEntryStore {
  createBonus(actor: Actor, body: CreateBonusBody): Promise<Recorded<Bonus>>;
  cancelBonus(actor: Actor, id: BonusId): Promise<Bonus>;
  createPenalty(actor: Actor, body: CreatePenaltyBody): Promise<Recorded<Penalty>>;
  cancelPenalty(actor: Actor, id: PenaltyId): Promise<Penalty>;
  /** The server chooses the period, the member's first open one (`adjustmentPeriod`). */
  createAdjustment(actor: Actor, body: AdjustmentToCreate): Promise<Recorded<PayAdjustment>>;
  /** `validated` → `paid`, by the owner only, at the revision shown, with how it was paid (`assertPayment`). */
  pay(
    actor: Actor,
    statementId: CommissionStatementId,
    payment: PayCommissionStatementBody,
  ): Promise<{ readonly period: PayPeriod }>;
}

/**
 * The sales an open period holds and the validator's decisions on them (CRM-03 lot b3, ADR 0050 § 5), each in one
 * transaction as the member who reads or decides (`withMember`): the owner and an active manager, never on a sale of
 * their own chatter. A decision runs under `payroll.close`, so that a closing sees it or it sees the closing.
 */
export interface PayrollSaleDecisionStore {
  heldSales(userId: UserId, period: PayPeriod): Promise<HeldSales>;
  /** The sales of a day a give may name a member on (ADR 0101 §§ 1, 2), as the held sales read them. */
  salesToGive(userId: UserId, period: PayPeriod, day: string): Promise<SalesToGive>;
  /** How many sales each validator gave in the month of `period` (ADR 0101 § 17): the owner only. */
  saleGifts(userId: UserId, period: PayPeriod): Promise<SaleGiftCounts>;
  decide(actor: Actor, body: CreatePaySaleDecisionBody): Promise<Recorded<PaySaleDecision>>;
}

/**
 * A member's own lines on the platform's net and their signals (CRM-03 lot b4c, ADR 0050 §§ 5, 10), as the member
 * (`withMember`): read from their own statement and signals, never from the register; a signal or its withdrawal on a
 * line of their statement of a period no closing closed, under `payroll.close`. Throws the module's errors.
 */
export interface PayrollSaleSignalStore {
  mySales(userId: UserId, query: MySalesQuery): Promise<MySales>;
  signal(actor: Actor, body: CreatePaySaleSignalBody): Promise<Recorded<PaySaleSignal>>;
}

/**
 * The team's rules (EQ-04, ADR 0032), set by the owner alone, each in one transaction as the owner (`withMember`)
 * under `payroll.close`: individual tiers and a collective goal for a period no statement is validated for yet, and
 * the minimum payout. Throws the module's errors, nothing is written then.
 */
export interface PayrollRuleStore {
  createBonusTierSet(actor: Actor, body: CreateBonusTierSetBody): Promise<Recorded<BonusTierSet>>;
  createCollectiveGoal(actor: Actor, body: CreateCollectiveGoalBody): Promise<Recorded<CollectiveGoal>>;
  /** PAIE-22: a payout minimum from a period that has not begun. */
  createPayoutMinimum(actor: Actor, body: CreatePayoutMinimumBody): Promise<Recorded<PayoutMinimum>>;
  /** PAIE-32: the payout delay announced; the settings as they stand for today's period. */
  setSettings(actor: Actor, body: UpdatePayrollSettingsBody): Promise<PayrollSettings>;
}

/** A rate as the ECB writes it (ADR 0033): units of `currency` for one euro, in decimal text, on `day`. */
export interface EcbRate {
  readonly day: string;
  readonly currency: ForeignCurrency;
  readonly perEuro: string;
}

/**
 * The ECB's last 90 days of the currencies pay uses, read and validated; throws when it cannot be reached, answers too
 * much or out of format.
 */
export interface RateSource {
  history(): Promise<readonly EcbRate[]>;
}

/** `exchange_rates`, written by the job only (admin connection), added only: a day once written never changes. */
export interface PayrollRateStore {
  /** Writes each rate whose (currency, day) is not written yet; gives how many, and those written with another value. */
  addUnscoped(
    rates: readonly ExchangeRate[],
  ): Promise<{ readonly written: number; readonly differing: readonly ExchangeRate[] }>;
  /** The ECB day of the newest rate written, for each currency that has one. */
  latestDaysUnscoped(): Promise<ReadonlyMap<ForeignCurrency, string>>;
}

/** A currency without a rate for too long (`exchange_rate_overdue`, ADR 0033). */
export interface OverdueRate {
  readonly currency: ForeignCurrency;
  /** `null`: no rate ever came since the job was first scheduled. */
  readonly lastRateDay: string | null;
  /** The ECB day of the check: one alert per day and currency. */
  readonly day: string;
}

/** The `domain_events` outbox, for the system alerts of pay (admin connection, no creator). */
/**
 * When the rate job was first scheduled on this database, `null` if never: where a currency that never got a rate
 * starts to count (ADR 0033).
 */
export type RateJobSince = () => Promise<Date | null>;

export interface PayrollRateAlerts {
  /** Publishes `exchange_rate_overdue`, unless that currency already has one that day. True when it published. */
  publishOverdue(alert: OverdueRate): Promise<boolean>;
}

/** Who reads pay: their scope (`withMember`) and their own member, `null` for the owner. */
export interface PayReader {
  readonly scope: TeamScope;
  readonly memberId: TeamMemberId | null;
}

/** A statement as written, its current revision's lines with it, and the team's figures it was computed with. */
export interface StoredStatement {
  readonly statement: Omit<CommissionStatement, 'canValidate' | 'team'>;
  readonly team: NonNullable<CommissionStatement['team']>;
}

/** A period as its reader may see it, through the policies (`withMember`). */
export interface PeriodView {
  readonly reader: PayReader;
  readonly window: PayPeriodWindow | null;
  /** The team's first closed period, `null` before any closing. */
  readonly firstClosed: PayPeriod | null;
  readonly closing: PayPeriodClosing | null;
  /** Why pay could not compute the period at its last try, as recorded: every member, whoever reads. */
  readonly blocked: PayPeriodBlock | null;
  readonly statements: readonly StoredStatement[];
  readonly bonusTierSets: readonly BonusTierSet[];
  readonly collectiveGoals: readonly CollectiveGoal[];
  readonly settings: PayrollSettings;
}

/** A period of the list as the database sums it, before the application says whether it has ended. */
type StoredPeriodSummary = Omit<PayPeriodSummary, 'ended'>;

export interface PayrollReadStore {
  period(userId: UserId, period: PayPeriod): Promise<PeriodView>;
  /**
   * The team's net over the period and the share of it that late reports brought, over every statement whoever reads
   * (ADR 0047 § 2, « ok A »): the one forecast of a collective goal. Only these two sums leave the store, never a
   * statement, so that a member reads how far the team will get, never its net.
   */
  teamTotalsUnscoped(
    period: PayPeriod,
  ): Promise<{ readonly netMinor: number; readonly lateNetMinor: number }>;
  /** The periods where the reader reads a statement, the most recent first: a page after `page.cursor`. */
  periods(
    userId: UserId,
    page: PageQuery,
  ): Promise<{ readonly items: readonly StoredPeriodSummary[]; readonly nextCursor: string | null }>;
  /** The period's bonuses, penalties and adjustments, cancelled ones included, the newest first. */
  entries(userId: UserId, period: PayPeriod): Promise<PayrollEntries>;
  settings(userId: UserId): Promise<PayrollSettings>;
  /** The latest rate of each currency the job read. */
  exchangeRates(userId: UserId): Promise<ExchangeRates>;
}

/** Why a transfer waits (ADR 0041): its documents, or the certificate of a year. */
export type PayoutHold =
  | { readonly reason: 'documents_not_issued'; readonly year: null }
  | { readonly reason: Exclude<PayoutBlockReason, 'documents_not_issued'>; readonly year: string };

/** What `PayoutGate` says of a transfer. */
export type PayoutVerdict =
  /** No treaty is involved: the transfer needs no certificate. */
  | { readonly kind: 'free' }
  /** The certificate of the transfer's year the owner accepted, which the record of the payment keeps. */
  | { readonly kind: 'covered'; readonly certificateId: string }
  | ({ readonly kind: 'blocked' } & PayoutHold);
