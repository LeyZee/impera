import type {
  AcceptContractTextBody,
  AgencyLogo,
  AgencyLogoMediaType,
  AssignContractorRegimeBody,
  BillingRegime,
  BillingRegimeId,
  BillingRegimes,
  BillingSettingsView,
  Bonus,
  BonusId,
  BonusTierSet,
  CollectiveGoal,
  CommissionStatement,
  CommissionStatementId,
  ContestCorrection,
  ContractAcceptance,
  ContractorDocument,
  ContractorDocumentId,
  ContractorDocumentMediaType,
  ContractorDocumentReview,
  ContractorFile,
  ContractorProfileBody,
  ContractorRegime,
  ContractText,
  ContractTextId,
  ContractTexts,
  CreateBillingRegimeBody,
  CreateContractTextBody,
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
  InvoicePrefixBody,
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
  UploadContractorDocumentQuery,
  UserId,
  ValidateBillingRegimeBody,
  VerifyContractorProfileBody,
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
  /**
   * Sends `bytes` signed with their SHA-256 (hex), under a compliance lock until `retainUntil`, as `mediaType` (a PDF
   * unless said: a contractor's document may be a photo, lot 5c).
   */
  writeOnce(
    key: string,
    bytes: Uint8Array,
    sha256: string,
    retainUntil: Date,
    mediaType?: string,
  ): Promise<'written' | 'exists'>;
  read(key: string): Promise<StoredObject | null>;
  /**
   * Moves the compliance lock of the object at `key` to `retainUntil`. A compliance lock only ever lengthens: an
   * earlier date is refused by the bucket, and throws.
   */
  lengthenLock(key: string, retainUntil: Date): Promise<void>;
  /**
   * Erases every version of the object at `key` for good, and the delete markers over them (« ok purge a » de
   * Charles, 01/11: a contractor's refused document), only when each version is the file of `sha256` and its lock, as
   * the bucket names it, has ended. `removed`; `absent` when the key holds no version; `locked` while a lock holds,
   * which the bucket would refuse anyway, nothing erased; `altered` when a version is another file, nothing erased.
   * Each version is erased by its id: a plain delete only hides the bytes behind a marker in a locked bucket.
   */
  remove(key: string, sha256: string): Promise<RemoveOutcome>;
  /** Whether the bucket holds a version of `key`, even one hidden behind a delete marker. Reads only. */
  holdsVersion(key: string): Promise<boolean>;
}

type RemoveOutcome = 'removed' | 'absent' | 'locked' | 'altered';

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
  /**
   * The storage keys of the tax residence certificates of an invoice under a tax treaty: those of its member, accepted
   * by the owner, of its period's civil year, kept as long as the invoice. Empty for any other document, and for an
   * invoice issued before any (ADR 0041: the invoice no longer waits for them; the transfer locks its own).
   */
  readonly certificateKeys: readonly string[];
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

/**
 * The contractor's file and the texts he accepts (EQ-06 lot 5a), under the reader's member context (`withMember`): the
 * policies and the triggers of `contractor_profiles`, `contract_texts` and `contract_acceptances` say it again. Each
 * write that may unblock an invoice (the file, its check, its prefix, a mandate accepted) enqueues
 * `payroll.requeue_invoice_issues` for the contractor in its transaction.
 */
export interface PayrollContractorStore {
  /** The file of `memberId` for the owner, an active manager or the contractor himself; `team_member_not_found` else. */
  file(userId: UserId, memberId: TeamMemberId): Promise<ContractorFile>;
  /** The contractor himself or the owner; the same values again write nothing. `created` on the first write. */
  writeProfile(
    actor: Actor,
    memberId: TeamMemberId,
    body: ContractorProfileBody,
  ): Promise<{ file: ContractorFile; created: boolean }>;
  /** The owner checks the file he read (`updatedAt`); a file checked already is given back. */
  verifyProfile(
    actor: Actor,
    memberId: TeamMemberId,
    body: VerifyContractorProfileBody,
  ): Promise<ContractorFile>;
  /** The owner sets the prefix, his own to the contractor, until his first invoice. */
  setPrefix(actor: Actor, memberId: TeamMemberId, body: InvoicePrefixBody): Promise<ContractorFile>;
  /** Every version of each kind, the newest first. */
  texts(userId: UserId): Promise<ContractTexts>;
  /** The owner adds the next version of a kind; the same `id` and text again give it back. */
  addText(actor: Actor, body: CreateContractTextBody): Promise<{ text: ContractText; created: boolean }>;
  /** The contractor accepts the newest version of a kind, as he read it (its SHA-256); again gives back the first. */
  accept(
    actor: Actor,
    textId: ContractTextId,
    body: AcceptContractTextBody,
  ): Promise<{ acceptance: ContractAcceptance; created: boolean }>;
}

/**
 * The billing regimes (EQ-06 lot 5b), each write as the owner through `withMember`: the base's policies let only him
 * write them, and its triggers keep a regime, its validation and a contractor's regimes added only.
 */
export interface PayrollRegimeStore {
  /** Every regime, the newest first, with the day the accountant validated it: any member reads them. */
  regimes(userId: UserId): Promise<BillingRegimes>;
  /** The owner adds a regime; the same `id` and regime again give it back. */
  addRegime(
    actor: Actor,
    body: CreateBillingRegimeBody,
  ): Promise<{ regime: BillingRegime; created: boolean }>;
  /** The owner records the accountant's validation, once, never ahead; the same day again gives the regime back. */
  validateRegime(
    actor: Actor,
    regimeId: BillingRegimeId,
    body: ValidateBillingRegimeBody,
  ): Promise<{ regime: BillingRegime; created: boolean }>;
  /** The owner gives a contractor a regime of his country from a day on; the same `id` and values give it back. */
  assignRegime(
    actor: Actor,
    memberId: TeamMemberId,
    body: AssignContractorRegimeBody,
  ): Promise<{ assignment: ContractorRegime; created: boolean }>;
}

/** A document's file as the store names it: its key, its fingerprint, what it is. */
interface DocumentFile {
  readonly key: string;
  readonly sha256: string;
  readonly mediaType: ContractorDocumentMediaType;
}

/**
 * A contractor's documents (EQ-06 lot 5c): filed by the contractor himself or the owner, never a manager; read by the
 * contractor, the owner and an active manager; checked once by the owner, never on his own file. The file goes to the
 * bucket between `prepareUpload` and `recordUpload`, outside any transaction: a run stopped between them is sent again
 * with the same `id` and finds its object (`exists`).
 */
export interface PayrollDocumentStore {
  /**
   * Checks an upload before its file goes up: the writer, the member, the day of issue. A document recorded under this
   * `id` with the same file and dates comes back (`recorded`); with others, `contractor_document_id_conflict`.
   * Otherwise the key to write and the end of the upload's lock (`new`).
   */
  prepareUpload(
    actor: Actor,
    memberId: TeamMemberId,
    query: UploadContractorDocumentQuery,
    file: Pick<DocumentFile, 'sha256' | 'mediaType'>,
  ): Promise<
    | { readonly kind: 'recorded'; readonly document: ContractorDocument }
    | { readonly kind: 'new'; readonly key: string; readonly lockUntil: Date }
  >;
  /** Records the document whose file is in the bucket, checked again under the member's lock. */
  recordUpload(
    actor: Actor,
    memberId: TeamMemberId,
    query: UploadContractorDocumentQuery,
    file: DocumentFile & { readonly lockUntil: Date },
  ): Promise<{ document: ContractorDocument; created: boolean }>;
  /** The document and its file under the reader's policy, `null` for none he sees. */
  documentFor(
    userId: UserId,
    memberId: TeamMemberId,
    documentId: ContractorDocumentId,
  ): Promise<{ readonly document: ContractorDocument; readonly file: DocumentFile } | null>;
  /**
   * The owner's check, once. An acceptance hands its file and the lock it records to `secure`, last in the check's
   * transaction (after its row, its line of `audit_log` and the requeue): the buckets lock the file as long as the
   * invoices it may cover, in both providers; one that refuses rolls the check back and records nothing.
   */
  review(
    actor: Actor,
    memberId: TeamMemberId,
    documentId: ContractorDocumentId,
    body: ContractorDocumentReview,
    secure: (file: DocumentFile, retainUntil: Date) => Promise<void>,
  ): Promise<{ document: ContractorDocument; created: boolean }>;
}

/** `payroll.requeue_invoice_issues`, as the jobs (`withAdmin`): enqueues the statements to try again, and counts them. */
export interface PayrollRequeueStore {
  requeueUnscoped(memberId: TeamMemberId | null): Promise<number>;
}

/**
 * `payroll.remind_documents`, as the jobs (`withAdmin`, EQ-06 lot 5c-2): on the agency's calendar day, each document
 * to remind of each member still in the team (`documentsToRemind`, under his regime of the day and the owner's delay)
 * is said once (`contractor_document_expiring`, with its line of `audit_log`); returns how many were said this run.
 */
export interface PayrollDocumentReminderStore {
  remindUnscoped(): Promise<number>;
}

/**
 * `payroll.settle_documents`, as the jobs (`withAdmin`, EQ-06 lot 7a): under each contractor's lock, his statements,
 * carry-overs and documents read, and the settlements `settlementsDue` finds written (`paid`, `imputed` or
 * `compensated`, with their lines of `audit_log`). Returns how many were written.
 */
export interface PayrollSettlementStore {
  /** One contractor, or every contractor with a document not settled yet (`null`). */
  settleUnscoped(memberId: TeamMemberId | null): Promise<number>;
}

/** A transfer that relied on a tax residence certificate (ADR 0041 § 4), whose lock the job lengthens (§ 6). */
export interface PayoutCertificate {
  readonly statementId: CommissionStatementId;
  readonly documentId: string;
  /** The certificate's key in both buckets. */
  readonly key: string;
  /** The day of the transfer, and the agency's fiscal year: the lock holds ten years after its close. */
  readonly paidOn: string;
  readonly fiscalYearEndMonth: number;
}

/**
 * `payroll.lock_payout_certificate`, as the jobs (`withAdmin`): the transfers whose record names a certificate
 * (`certificateDocumentId` of `commission_statement.pay`) without a line saying it was locked for them, and that line
 * (`commission_statement.certificate_locked`), written once.
 */
export interface PayrollPayoutCertificateStore {
  /** One transfer, or every transfer whose certificate is not locked yet (`null`). */
  toLockUnscoped(statementId: CommissionStatementId | null): Promise<readonly PayoutCertificate[]>;
  /** Both buckets hold it at least until `retainUntil`; `false` when another run said it first. */
  recordLockedUnscoped(certificate: PayoutCertificate, retainUntil: Date): Promise<boolean>;
}

/** A refused document's file, as the purge reads it: where it lies and what it is. */
interface RefusedFile {
  readonly documentId: ContractorDocumentId;
  readonly memberId: TeamMemberId;
  readonly key: string;
  readonly sha256: string;
}

/**
 * `payroll.purge_refused_documents`, as the jobs (`withAdmin`, EQ-06 lot 5c-2, « ok purge a »): the refused documents
 * whose upload lock has ended and whose file is not erased yet; then the erasure recorded once its file is gone.
 */
export interface PayrollDocumentPurgeStore {
  /** Oldest lock first, a bounded batch: the next night takes the rest. */
  dueUnscoped(): Promise<readonly RefusedFile[]>;
  /**
   * Records the erasure with its line of `audit_log`, once (`false` when it was recorded already). The base refuses it
   * for a document the owner did not refuse, or whose upload lock has not ended.
   */
  recordUnscoped(file: RefusedFile, outcome: 'removed' | 'absent'): Promise<boolean>;
}
