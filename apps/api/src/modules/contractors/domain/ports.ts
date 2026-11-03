import type {
  AcceptContractTextBody,
  AgencyLogo,
  AssignContractorRegimeBody,
  BillingRegime,
  BillingRegimeId,
  BillingRegimes,
  BillingSettingsView,
  CommissionStatementId,
  ContractAcceptance,
  ContractorDocument,
  ContractorDocumentId,
  ContractorDocumentReview,
  PendingContractorDocuments,
  ContractorFile,
  ContractorProfileBody,
  ContractorRegime,
  ContractText,
  ContractTextId,
  ContractTexts,
  CreateBillingRegimeBody,
  CreateContractTextBody,
  InvoicePrefixBody,
  JournalAccounts,
  TeamMemberId,
  UpdateBillingSettingsBody,
  UploadContractorDocumentQuery,
  UserId,
  ValidateBillingRegimeBody,
  VerifyContractorProfileBody,
  ContractorDocumentMediaType,
} from '@impera/contracts';

import type { PngSize } from './agency-logo';

/** Who validates, for the policies (`withMember`) and the audit line. */
export interface Actor {
  readonly userId: UserId;
  readonly ip: string | null;
}

/** What the module's jobs say when something needs a look: a period they could not compute, a statement that drifted. */
export interface JobLogger {
  warn(object: object, message: string): void;
  error(object: object, message: string): void;
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
  /**
   * Saves the export's accounts and journals (EQ-06 lot 7b), the other settings unchanged; the same values again
   * write nothing. `billing_settings_missing_conflict` before the settings are first saved.
   */
  updateAccounts(actor: Actor, body: JournalAccounts): Promise<BillingSettingsView>;
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
  /**
   * Every member's documents without a check, the oldest filed first, with the member's name: the owner only
   * (`payroll_forbidden` otherwise), who alone checks one, never his own ones, which he may not check (lot 8).
   */
  pending(userId: UserId): Promise<PendingContractorDocuments>;
}

/**
 * `payroll.remind_documents`, as the jobs (`withAdmin`, EQ-06 lot 5c-2): on the agency's calendar day, each document
 * to remind of each member still in the team (`documentsToRemind`, under his regime of the day and the owner's delay)
 * is said once (`contractor_document_expiring`, with its line of `audit_log`); returns how many were said this run.
 */
export interface PayrollDocumentReminderStore {
  remindUnscoped(): Promise<number>;
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

/** A document's file as the store names it: its key, its fingerprint, what it is. */
interface DocumentFile {
  readonly key: string;
  readonly sha256: string;
  readonly mediaType: ContractorDocumentMediaType;
}

/** A refused document's file, as the purge reads it: where it lies and what it is. */
interface RefusedFile {
  readonly documentId: ContractorDocumentId;
  readonly memberId: TeamMemberId;
  readonly key: string;
  readonly sha256: string;
}
