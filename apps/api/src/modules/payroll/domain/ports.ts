import type {
  AgencyLogo,
  AgencyLogoMediaType,
  BillingSettingsView,
  Bonus,
  BonusId,
  BonusTierSet,
  CollectiveGoal,
  CommissionStatement,
  CommissionStatementId,
  ContestCorrection,
  CreateBonusBody,
  CreateBonusTierSetBody,
  CreateCollectiveGoalBody,
  CreatePayoutMinimumBody,
  CreatePenaltyBody,
  DomainError,
  ExchangeRate,
  ExchangeRates,
  ForeignCurrency,
  InvoiceAcceptanceView,
  InvoiceId,
  InvoiceKind,
  InvoicePdfCopyProvider,
  InvoicePdfPlace,
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
  PayoutMinimum,
  PayrollSettings,
  Penalty,
  PenaltyId,
  TeamMemberId,
  TeamScope,
  UpdateBillingSettingsBody,
  UpdatePayrollSettingsBody,
  UserId,
} from '@nirvana/contracts';

import type { PngSize } from './agency-logo';
import type { IssueWarning } from './billing';
import type { InvoicePdfContent, PdfDocumentSource } from './invoice-pdf';
import type { DocumentNotIssued, InvoicingFacts, InvoicingPlan } from './invoicing';
import type { PeriodBlockReason } from './period-blocks';
import type { PeriodPlan, PeriodSnapshot, ReportForPay } from './recalculation';

/** Who validates, for the policies (`withMember`) and the audit line. */
export interface Actor {
  readonly userId: UserId;
  readonly ip: string | null;
}

/** One creator's validated reports, as the member who validates reads them in her (ADR 0032). */
export interface CreatorReports {
  readonly creatorId: string;
  readonly reports: readonly ReportForPay[];
}

/** What the module's jobs say when something needs a look: a period they could not compute, a statement that drifted. */
export interface JobLogger {
  warn(object: object, message: string): void;
  error(object: object, message: string): void;
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

/** What the invoicing job did for a statement, for its log line. */
export type InvoicingOutcome =
  | { readonly kind: 'not_validated' }
  | {
      readonly kind: 'planned';
      readonly issued: readonly { readonly kind: InvoiceKind; readonly number: string }[];
      readonly notIssued: readonly DocumentNotIssued[];
      readonly warnings: readonly IssueWarning[];
    };

/** `payroll.issue_invoices` (EQ-06 lot 3): the documents of a validated statement, as the jobs write them. */
export interface PayrollInvoiceStore {
  /**
   * One transaction as the jobs (`withAdmin`), under the contractor's lock: reads what the statement's documents are
   * made of, hands it to `plan`, numbers each document the plan gives on the contractor's counter (`FOR UPDATE`) and
   * writes it with its lines and its event `issued`, then publishes `invoice_not_issued` for each one it does not
   * issue. A statement still a draft gets nothing.
   */
  issueUnscoped(
    statementId: CommissionStatementId,
    plan: (facts: InvoicingFacts) => InvoicingPlan,
  ): Promise<InvoicingOutcome>;
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

/** One object of a bucket as read back: its bytes, and the end of its compliance lock as the bucket gives it. */
export interface StoredObject {
  readonly bytes: Uint8Array;
  /** `null` when the bucket names no lock on it: never taken for a lock that holds. */
  readonly retainUntil: Date | null;
}

/**
 * A bucket of invoices under compliance lock (ADR 0037 § 4 and § 6). An object is written once, with its lock, and
 * never replaced: a key that already holds one is `exists`, whatever it holds. A provider that does not answer, or
 * answers an error, throws `InvoiceStorageUnavailable`; a key that holds nothing reads `null`.
 */
export interface InvoiceObjectStore {
  /**
   * `true` for a store that loses its objects with the process (memory, development): an object a row names and the
   * store does not hold was forgotten, not damaged, and never alerts. `false` for a bucket, whose lock keeps them.
   */
  readonly volatile: boolean;
  /** Sends `bytes` signed with their SHA-256 (hex), under a compliance lock until `retainUntil`. */
  writeOnce(key: string, bytes: Uint8Array, sha256: string, retainUntil: Date): Promise<'written' | 'exists'>;
  read(key: string): Promise<StoredObject | null>;
  /**
   * Moves the compliance lock of the object at `key` to `retainUntil`. A compliance lock only ever lengthens: an
   * earlier date is refused by the bucket, and throws.
   */
  lengthenLock(key: string, retainUntil: Date): Promise<void>;
}

/** The agency's logo a document froze by its fingerprint (`agency_logos`), a PNG. */
export interface InvoiceLogo {
  readonly mediaType: AgencyLogoMediaType;
  readonly bytes: Uint8Array;
}

/**
 * Lays out a PDF's content as a PDF/A-3b, the same bytes for the same content, logo and instant (ADR 0037 § 2). A
 * character its font has no glyph for throws `InvoicePdfGlyphMissing`: nothing is ever printed as a blank box.
 */
export interface InvoicePdfRenderer {
  render(content: InvoicePdfContent, logo: InvoiceLogo | null, issuedAt: Date): Promise<Uint8Array>;
}

/** A PDF as its row keeps it (`invoice_pdfs`), with the copies written so far (`invoice_pdf_copies`). */
export interface StoredInvoicePdf {
  readonly key: string;
  readonly sha256: string;
  readonly retainUntil: Date;
  readonly copies: readonly {
    readonly provider: InvoicePdfCopyProvider;
    readonly key: string;
    readonly sha256: string;
    readonly retainUntil: Date;
  }[];
}

/** An issued document as its PDF job reads it: what it prints, where its lock ends, and its PDF once written. */
export interface InvoiceToRender {
  readonly id: InvoiceId;
  readonly memberId: TeamMemberId;
  readonly number: string;
  readonly issuedAt: Date;
  readonly issuedOn: string;
  readonly document: PdfDocumentSource;
  /** The logo the document froze, `null` for none. */
  readonly logo: InvoiceLogo | null;
  /** The month the agency's fiscal year closes in (`billing_settings`), read when the PDF is rendered. */
  readonly fiscalYearEndMonth: number;
  readonly pdf: StoredInvoicePdf | null;
}

/** What tells the owner that a PDF or a copy is wrong or missing (ADR 0037 § 5 to § 7), with its document. */
type InvoicePdfAlert =
  | {
      readonly type: 'invoice_pdf_conflict';
      readonly invoiceId: InvoiceId;
      readonly memberId: TeamMemberId;
      readonly number: string;
      readonly place: InvoicePdfPlace;
      readonly stage: 'render' | 'copy' | 'download';
    }
  | {
      readonly type: 'invoice_pdf_missing';
      readonly invoiceId: InvoiceId;
      readonly memberId: TeamMemberId;
      readonly number: string;
      readonly place: InvoicePdfPlace;
    };

/** The PDFs' rows and alerts (EQ-06 lot 4): the jobs write as admin, a reader downloads under the invoice's policy. */
export interface PayrollInvoicePdfStore {
  /** The document, its fiscal year's close and its PDF, as the jobs (`withAdmin`); `null` for an unknown id. */
  toRenderUnscoped(invoiceId: InvoiceId): Promise<InvoiceToRender | null>;
  /**
   * Writes the PDF's row once (a row already there stays as it is), and in the same transaction enqueues its copy
   * (`payroll.mirror_invoice_pdf`) and writes its line of `audit_log`.
   */
  recordPdfUnscoped(
    invoiceId: InvoiceId,
    pdf: { readonly key: string; readonly sha256: string; readonly retainUntil: Date },
  ): Promise<void>;
  /** Writes a copy's row once, with its line of `audit_log`; the database refuses a copy unlike its PDF. */
  recordCopyUnscoped(
    invoiceId: InvoiceId,
    provider: InvoicePdfCopyProvider,
    copy: { readonly key: string; readonly sha256: string; readonly retainUntil: Date },
  ): Promise<void>;
  /** Publishes `alert` and its line of `audit_log`, once for a document, place and stage: `already` after. */
  alertUnscoped(alert: InvoicePdfAlert): Promise<'published' | 'already'>;
  /**
   * The document as `userId` may read it (`withMember`, the invoice's policy): `null` when it does not exist or is
   * not theirs to read, its PDF `null` while not rendered.
   */
  pdfFor(
    userId: UserId,
    invoiceId: InvoiceId,
  ): Promise<{
    readonly memberId: TeamMemberId;
    readonly number: string;
    readonly pdf: StoredInvoicePdf | null;
  } | null>;
}

/** « J'accepte » or « Je conteste » with its reason: the contractor's answer to their document (ADR 0039 § 1). */
type InvoiceAnswer = { readonly kind: 'accept' } | { readonly kind: 'contest'; readonly reason: string };

/**
 * A document's acceptance (EQ-06 lot 6, ADR 0039): the contractor answers and the owner ends a contest as themselves
 * (`withMember`, the policies of `invoice_events` say who writes what), the dated jobs as admin. Every write
 * holds the document's lock (one answer, one end of a contest, even from two requests at once) and checks the delay on
 * the database's clock, the one its trigger checks.
 */
export interface PayrollInvoiceAcceptanceStore {
  /** The document's acceptance as `userId` may read it; `null` when it does not exist or is not theirs to read. */
  read(userId: UserId, invoiceId: InvoiceId): Promise<InvoiceAcceptanceView | null>;
  /**
   * Records the contractor's answer, its line of `audit_log`, and for a contest the job that tells the owner
   * (`payroll.announce_invoice_contest`). The same answer sent again writes nothing and gives the view back.
   */
  answer(actor: Actor, invoiceId: InvoiceId, answer: InvoiceAnswer): Promise<InvoiceAcceptanceView>;
  /** The owner refuses a contest, with its reason and its line of `audit_log`; the same refusal sent again, nothing. */
  refuseContest(actor: Actor, invoiceId: InvoiceId, reason: string): Promise<InvoiceAcceptanceView>;
  /**
   * The owner upholds a contest, with its reason, and writes its correction in the same transaction (ADR 0039 § 3):
   * the adjustments of `correctionAdjustments`, each naming the document and correcting its period, on the member's
   * first open period, as any adjustment (its locks, its recalculation, its line of `audit_log`). The same uphold and
   * correction sent again write nothing; another correction after it is a conflict.
   */
  upholdContest(
    actor: Actor,
    invoiceId: InvoiceId,
    reason: string,
    correction: ContestCorrection,
  ): Promise<InvoiceAcceptanceView>;
  /**
   * The tacit acceptance of a document nobody answered, at its deadline (`withAdmin`): `early` when the database's
   * clock is not there yet (the job is put back at the deadline), `answered` when an answer came first.
   */
  lapseUnscoped(invoiceId: InvoiceId): Promise<'lapsed' | 'answered' | 'early' | 'not_found'>;
  /**
   * Publishes `invoice_contested` and its line of `audit_log`, once per document: `already` after, `closed` when the
   * contest has ended before (the owner, who ended it, knows).
   */
  announceContestUnscoped(
    invoiceId: InvoiceId,
  ): Promise<'published' | 'already' | 'closed' | 'not_contested' | 'not_found'>;
  /**
   * What the hourly sweep catches up (`withAdmin`), `limit` of each, oldest first: the documents still unanswered after
   * their deadline, and the open contests without their alert.
   */
  dueUnscoped(limit: number): Promise<{
    readonly unanswered: readonly InvoiceId[];
    readonly unannounced: readonly InvoiceId[];
  }>;
}

/**
 * Réglages › Facturation (EQ-06), the owner's alone: what each invoice issued from now on copies, and the logos, each
 * kept by its fingerprint and never changed (an invoice names the one it printed, ADR 0037 § 2).
 */
export interface PayrollBillingSettingsStore {
  read(userId: UserId): Promise<BillingSettingsView>;
  /** Saves the settings (the same values again write nothing); the logo named must have been added. */
  update(actor: Actor, body: UpdateBillingSettingsBody): Promise<BillingSettingsView>;
  /** Keeps a logo already checked (`agencyLogoVerdict`); the same bytes again give back the same logo. */
  addLogo(actor: Actor, bytes: Uint8Array, size: PngSize): Promise<{ logo: AgencyLogo; created: boolean }>;
  /** A logo's bytes for its owner's screen, `null` when none has this fingerprint. */
  logoBytes(userId: UserId, sha256: string): Promise<Uint8Array | null>;
}
