import type {
  AgencyLogoMediaType,
  CommissionStatementId,
  ContestCorrection,
  InvoiceAcceptanceView,
  InvoiceId,
  InvoiceKind,
  InvoiceList,
  InvoiceListQuery,
  InvoicePdfCopyProvider,
  InvoicePdfPlace,
  TeamMemberId,
  UserId,
} from '@nirvana/contracts';

import type { Actor } from '../../contractors/pure';

import type { IssueWarning } from './billing';
import type { InvoicePdfContent, PdfDocumentSource } from './invoice-pdf';
import type { DocumentNotIssued, InvoicingFacts, InvoicingPlan } from './invoicing';

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
   * The documents `userId` reads (the policy of `invoices`), filtered by `query`, the latest issued first, each with its
   * acceptance, its settlement and its due state on the agency's calendar day (EQ-06 lot 8).
   */
  list(userId: UserId, query: InvoiceListQuery): Promise<InvoiceList>;
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

/** `payroll.requeue_invoice_issues`, as the jobs (`withAdmin`): enqueues the statements to try again, and counts them. */
export interface PayrollRequeueStore {
  requeueUnscoped(memberId: TeamMemberId | null): Promise<number>;
}

/**
 * `payroll.remind_due_invoices`, as the jobs (`withAdmin`, EQ-06 lot 8): each invoice not settled yet, whose due state
 * is `soon` or `overdue` on the agency's day (`invoiceDueState`, the list's rule), is said once per type
 * (`invoice_due_soon`, `invoice_overdue`, with its line of `audit_log`), with what stops the transfer that will pay it
 * (`payingStatement`, `payoutDecision`). Returns how many were said this run.
 */
export interface PayrollInvoiceDueStore {
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
