import type { CommissionStatementId, InvoiceId, TeamMemberId } from '@nirvana/contracts';
import type { Database } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { InvoiceObjectStore } from '../contractors';
import type { JobLogger } from '../contractors/pure';
import type { PayrollModule } from '../payroll';

import {
  announceInvoiceContest,
  createPayrollInvoiceAcceptance,
  lapseInvoice,
  sweepInvoiceAcceptance,
  type ContestAnnounceOutcome,
  type LapseOutcome,
  type SweepOutcome,
} from './application/invoice-acceptance';
import {
  checkedInvoicePdf,
  downloadInvoicePdf,
  mirrorInvoicePdf,
  renderInvoicePdf,
  type CheckedPdf,
  type JobAttempt,
  type PdfToServe,
  type MirrorOutcome,
  type RenderOutcome,
} from './application/invoice-pdfs';
import { issueInvoices, requeueInvoiceIssues } from './application/invoicing';
import type { InvoicingOutcome } from './domain/ports';
import { createDrizzlePayrollInvoiceAcceptanceStore } from './infra/invoice-acceptance-store';
import { createDrizzleInvoiceDueStore } from './infra/invoice-due-store';
import { createPdfkitInvoiceRenderer, loadInvoiceFonts } from './infra/invoice-pdf-renderer';
import { createDrizzlePayrollInvoicePdfStore } from './infra/invoice-pdf-store';
import { createDrizzlePayrollInvoiceStore } from './infra/invoice-store';
import type { InvoicingReads } from './infra/ports';
import { createDrizzlePayrollRequeueStore } from './infra/requeue-store';
import { createInvoicingRoutes, type RequireRole } from './infra/routes';
import { createDrizzleSettlementStore } from './infra/settlement-store';

/**
 * What a change of a contractor's file asks of the invoices (`InvoiceRequeue`, ADR 0047 § 1): the composition root plugs
 * it into `contractors`, which never imports this module.
 */
export { invoiceRequeue } from './infra/invoice-queue';
/** What the contractors' file reads of the invoices, plugged into it by the composition root (ARC-07). */
export { invoiceReadsForContractors } from './infra/contractor-reads';
/**
 * What pay asks of the invoices before a transfer (`PayoutGate`) and after a validation (`AfterValidation`, with the
 * contractors' certificate lock), plugged into `payroll` by the composition root: pay never imports this module.
 */
export { invoicesAfterValidation, payoutGate } from './infra/gates';
/** A rendered PDF read back against its fingerprint (ADR 0037 § 7), what the accountant's archive reads. */
export type { CheckedPdf, PdfToServe } from './application/invoice-pdfs';

/** What the accountant's exports read of this module, in their transaction (ADR 0047 § 1, ARC-07). */
export { invoiceReadsForAccounting } from './infra/accounting-reads';
/**
 * Public entry point of the `invoicing` module (ADR 0047 § 1): the invoices and credit notes of the contractors, their
 * issue, PDF/A and copies, acceptance, contest, cancel and corrective invoice, settlement and due dates. Other modules
 * import this file, or `pure.ts` for its pure rules (ADR 0051).
 */
export interface InvoicingModule {
  readonly name: 'invoicing';
  /** Mounted under `/v1` by the server: `/payroll/invoices/…` (contracts `payroll.ts`). */
  routes(requireRole: RequireRole): FastifyPluginAsyncZod;
  /**
   * A rendered PDF read back from the first bucket, or from the copy when the first one does not give it whole
   * (`checkedInvoicePdf`): the accountant's archive reads each document through it (`accounting`, ADR 0047 § 1).
   */
  readonly checkedPdf: (pdf: PdfToServe, logger: JobLogger) => Promise<CheckedPdf>;
  readonly jobs: {
    /**
     * `payroll.issue_invoices` (EQ-06 lot 3, ADR 0036): a validated statement's invoice and the credit notes its period
     * owes, numbered on the contractor's counter; what cannot be issued is said to the owner (`invoice_not_issued`).
     * Replayable: a run issues only what is missing.
     */
    readonly issueInvoices: (
      statementId: CommissionStatementId,
      logger: JobLogger,
    ) => Promise<InvoicingOutcome>;
    /**
     * `payroll.requeue_invoice_issues` (EQ-06 lot 5a): once a contractor's file, prefix, check or mandate changes (or
     * the agency's settings, `null`), each statement of his for which `invoice_not_issued` was said gets its
     * `payroll.issue_invoices` again. Returns how many.
     */
    readonly requeueInvoiceIssues: (memberId: TeamMemberId | null) => Promise<number>;
    /**
     * `payroll.render_invoice_pdf` (EQ-06 lot 4, ADR 0037 § 5): an issued document's PDF, rendered once from its frozen
     * data and written under lock; its row then enqueues its copy. Never replaces an object; its last failed attempt
     * tells the owner (`invoice_pdf_missing`).
     */
    readonly renderInvoicePdf: (
      invoiceId: InvoiceId,
      attempt: JobAttempt,
      logger: JobLogger,
    ) => Promise<RenderOutcome>;
    /** `payroll.mirror_invoice_pdf` (ADR 0037 § 6): the same bytes, same key and lock, at the second provider. */
    readonly mirrorInvoicePdf: (
      invoiceId: InvoiceId,
      attempt: JobAttempt,
      logger: JobLogger,
    ) => Promise<MirrorOutcome>;
    /**
     * `payroll.lapse_invoice` (EQ-06 lot 6, ADR 0039 § 1): enqueued at the issue to start at the deadline, accepts
     * tacitly a document left without an answer; does nothing once it is answered.
     */
    readonly lapseInvoice: (invoiceId: InvoiceId, logger: JobLogger) => Promise<LapseOutcome>;
    /**
     * `payroll.announce_invoice_contest` (ADR 0039 § 2): enqueued with a contest, publishes `invoice_contested` once per
     * document, without the reason nor a name; nothing once the contest has ended.
     */
    readonly announceInvoiceContest: (
      invoiceId: InvoiceId,
      logger: JobLogger,
    ) => Promise<ContestAnnounceOutcome>;
    /**
     * `payroll.sweep_invoice_acceptance`, each hour: a document unanswered after its deadline accepted tacitly, an open
     * contest without its alert said, should their own job have failed or been lost.
     */
    readonly sweepInvoiceAcceptance: (logger: JobLogger) => Promise<SweepOutcome>;
    /**
     * `payroll.remind_due_invoices`, each morning (EQ-06 lot 8): each invoice not settled yet said once to the owner
     * seven days before its due date (`invoice_due_soon`), then once the day after it (`invoice_overdue`), with what
     * stops the transfer that will pay it (ADR 0041). Returns how many were said this run.
     */
    readonly remindDueInvoices: () => Promise<number>;
    /**
     * `payroll.settle_documents` (EQ-06 lot 7a): each document a paid transfer settles, its own statement's or one it
     * received in carry-over, marked `paid` (an invoice) or `imputed` (a credit note), once. One contractor, or every
     * contractor with a document not settled yet (`null`). Returns how many were written.
     */
    readonly settleDocuments: (memberId: TeamMemberId | null) => Promise<number>;
  };
}

export interface InvoicingDeps {
  /** Application role: what a member reads and answers runs through `withMember`. */
  readonly db: Database;
  /** Admin role, for the jobs, which issue and render every contractor's documents. */
  readonly adminDb: Database;
  /** What the invoices read of the planning, from its `index.ts`. */
  readonly reads: InvoicingReads;
  /** Pay, from its `index.ts`: the correction of an upheld contest is written by it (ADR 0039 § 3). */
  readonly payroll: Pick<PayrollModule, 'correctContest'>;
  readonly now?: () => Date;
  /**
   * The invoices' PDFs (ADR 0037): the folder of their fonts, read once here (a missing file stops the start, never
   * the first invoice), and their two buckets.
   */
  readonly invoicePdfs: {
    readonly fontsDir: string;
    readonly primary: InvoiceObjectStore;
    readonly copy: InvoiceObjectStore;
  };
}

export function createInvoicingModule(deps: InvoicingDeps): InvoicingModule {
  const now = deps.now ?? (() => new Date());
  const invoiceStore = createDrizzlePayrollInvoiceStore(deps.adminDb, deps.reads, now);
  const pdfs = {
    store: createDrizzlePayrollInvoicePdfStore(deps.db, deps.adminDb, deps.reads, now),
    renderer: createPdfkitInvoiceRenderer(loadInvoiceFonts(deps.invoicePdfs.fontsDir)),
    primary: deps.invoicePdfs.primary,
    copy: deps.invoicePdfs.copy,
  };
  const acceptanceStore = createDrizzlePayrollInvoiceAcceptanceStore(
    deps.db,
    deps.adminDb,
    deps.reads,
    deps.payroll.correctContest,
    now,
  );
  return {
    name: 'invoicing',
    routes: (requireRole) =>
      createInvoicingRoutes(
        (userId, invoiceId, logger) => downloadInvoicePdf(pdfs, userId, invoiceId, logger),
        createPayrollInvoiceAcceptance(acceptanceStore),
        requireRole,
      ),
    checkedPdf: (pdf, logger) => checkedInvoicePdf(pdfs, pdf, logger),
    jobs: {
      issueInvoices: (statementId, logger) => issueInvoices(invoiceStore, statementId, logger),
      requeueInvoiceIssues: (memberId) =>
        requeueInvoiceIssues(createDrizzlePayrollRequeueStore(deps.adminDb), memberId),
      renderInvoicePdf: (invoiceId, attempt, logger) => renderInvoicePdf(pdfs, invoiceId, attempt, logger),
      mirrorInvoicePdf: (invoiceId, attempt, logger) => mirrorInvoicePdf(pdfs, invoiceId, attempt, logger),
      lapseInvoice: (invoiceId, logger) => lapseInvoice(acceptanceStore, invoiceId, logger),
      announceInvoiceContest: (invoiceId, logger) =>
        announceInvoiceContest(acceptanceStore, invoiceId, logger),
      sweepInvoiceAcceptance: (logger) => sweepInvoiceAcceptance(acceptanceStore, logger),
      remindDueInvoices: () => createDrizzleInvoiceDueStore(deps.adminDb, deps.reads, now).remindUnscoped(),
      settleDocuments: (memberId) => createDrizzleSettlementStore(deps.adminDb).settleUnscoped(memberId),
    },
  };
}
