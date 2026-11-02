import type {
  CommissionStatementId,
  ExchangeRate,
  ForeignCurrency,
  InvoiceId,
  PayPeriod,
  TeamMemberId,
  UserId,
} from '@nirvana/contracts';
import type { Database } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { InvoiceObjectStore } from '../contractors';
import type { JobLogger } from '../contractors/pure';

import { createPayrollAccounting } from './application/accounting';
import { createPayrollEntries } from './application/entries';
import { fetchExchangeRates, type RateFetchOutcome } from './application/exchange-rates';
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
  downloadInvoicePdf,
  mirrorInvoicePdf,
  renderInvoicePdf,
  type JobAttempt,
  type MirrorOutcome,
  type RenderOutcome,
} from './application/invoice-pdfs';
import { issueInvoices, requeueInvoiceIssues } from './application/invoicing';
import { createPayrollReads } from './application/periods';
import { createRecalculation, type RecalculationOutcome } from './application/recalculation';
import { createPayrollValidation } from './application/validation';
import type { InvoicingOutcome, RateJobSince } from './domain/ports';
import { createDrizzlePayrollAccountingStore } from './infra/accounting-store';
import { createEcbSource, type GetLike } from './infra/ecb';
import { createDrizzlePayrollEntryStore } from './infra/entry-store';
import { createDrizzlePayrollInvoiceAcceptanceStore } from './infra/invoice-acceptance-store';
import { createDrizzleInvoiceDueStore } from './infra/invoice-due-store';
import { createPdfkitInvoiceRenderer, loadInvoiceFonts } from './infra/invoice-pdf-renderer';
import { createDrizzlePayrollInvoicePdfStore } from './infra/invoice-pdf-store';
import { createDrizzlePayrollInvoiceStore } from './infra/invoice-store';
import { createDrizzlePayrollJobStore } from './infra/job-store';
import { createLatestRateRead } from './infra/latest-rate';
import { createPostgresRateAlerts } from './infra/rate-alerts';
import { createDrizzlePayrollRateStore } from './infra/rate-store';
import { createDrizzlePayrollReadStore } from './infra/read-store';
import { createDrizzlePayrollRequeueStore } from './infra/requeue-store';
import { createPayrollRoutes, type RequireRole } from './infra/routes';
import { createDrizzlePayrollRuleStore } from './infra/rule-store';
import { createDrizzleSettlementStore } from './infra/settlement-store';
import type { PayInputReads } from './infra/snapshot';
import { createDrizzlePayrollValidationStore } from './infra/validation-store';

/**
 * Pay's `payroll.recalculate` for a period, in the caller's transaction: the planning enqueues it when it validates a
 * report, through the composition root (EQ-04). One key and one number of attempts for every writer.
 */
export { enqueuePayRecalculation } from './infra/recalculation-queue';

/**
 * What a change of a contractor's file asks of the invoices (`InvoiceRequeue`, ADR 0047 § 1): the composition root plugs
 * it into `contractors`, which never imports this module.
 */
export { invoiceRequeue } from './infra/invoice-queue';

/** Public entry point of the `payroll` module (EQ-04, ADR 0002). Other modules import this file only. */
export interface PayrollModule {
  readonly name: 'payroll';
  /** Mounted under `/v1` by the server: `/payroll/…` (contracts `payroll.ts`). */
  routes(requireRole: RequireRole): FastifyPluginAsyncZod;
  /**
   * The newest rate of a currency (ADR 0033), `null` before the first: the last ECB rate known, the one a draft of pay
   * keeps. Read under the reader's member context (`withMember`, policy `team_read`); the composition root gives it to
   * the Dashboard, which ranks its best fans with it and shows only its day.
   */
  readonly latestRate: (userId: UserId, currency: ForeignCurrency) => Promise<ExchangeRate | null>;
  readonly jobs: {
    /**
     * `payroll.recalculate` (ADR 0032): the drafts of a period, and those of the team's first open period when it is
     * closed. A period that cannot be computed yet (a missing rate) is logged, never guessed.
     */
    readonly recalculate: (period: PayPeriod, logger: JobLogger) => Promise<RecalculationOutcome[]>;
    /** `payroll.recalculate_open`: every open period up to the current one, each hour. */
    readonly recalculateOpen: (logger: JobLogger) => Promise<RecalculationOutcome[]>;
    /**
     * `payroll.fetch_exchange_rates` (ADR 0033): the ECB's last 90 days, each day written once; then
     * `exchange_rate_overdue`, once a day, for a currency without a rate for more than two weekdays (in production,
     * also one that never got a rate).
     */
    readonly fetchExchangeRates: (logger: JobLogger) => Promise<RateFetchOutcome>;
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

export interface PayrollDeps {
  /** Application role: what a member reads runs through `withMember`. */
  readonly db: Database;
  /**
   * Admin role, for the jobs, which read every creator's reports (ADR 0023 § Paie), and for the one check of a closing
   * that the member who validates read every report it counts (ADR 0032).
   */
  readonly adminDb: Database;
  /** What pay reads of the planning, the team and the creators, from their `index.ts`. */
  readonly reads: PayInputReads;
  readonly now?: () => Date;
  /** The ECB is reached through it (ADR 0033); the global `fetch` unless a test gives a fake one. */
  readonly fetch?: GetLike;
  /**
   * Production only (composition root): when the rate job was first scheduled, so that a currency that never got a
   * rate is alerted too (ADR 0033). `null` elsewhere.
   */
  readonly rateJobSince: RateJobSince | null;
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

export function createPayrollModule(deps: PayrollDeps): PayrollModule {
  const now = deps.now ?? (() => new Date());
  const jobStore = createDrizzlePayrollJobStore(deps.adminDb, deps.reads, now);
  const reads = createPayrollReads(
    createDrizzlePayrollReadStore(deps.db, deps.adminDb, deps.reads, now),
    now,
  );
  const validation = createPayrollValidation(
    createDrizzlePayrollValidationStore(deps.db, deps.adminDb, deps.reads, now),
    reads,
  );
  const entries = createPayrollEntries(createDrizzlePayrollEntryStore(deps.db, deps.reads, now), reads);
  const rules = createDrizzlePayrollRuleStore(deps.db, deps.reads, now);
  const invoiceStore = createDrizzlePayrollInvoiceStore(deps.adminDb, deps.reads, now);
  const pdfs = {
    store: createDrizzlePayrollInvoicePdfStore(deps.db, deps.adminDb, deps.reads, now),
    renderer: createPdfkitInvoiceRenderer(loadInvoiceFonts(deps.invoicePdfs.fontsDir)),
    primary: deps.invoicePdfs.primary,
    copy: deps.invoicePdfs.copy,
  };
  const acceptanceStore = createDrizzlePayrollInvoiceAcceptanceStore(deps.db, deps.adminDb, deps.reads, now);
  const rateJob = {
    source: createEcbSource({ fetch: deps.fetch ?? ((url, init) => fetch(url, init)) }),
    store: createDrizzlePayrollRateStore(deps.adminDb),
    alerts: createPostgresRateAlerts(deps.adminDb),
    since: deps.rateJobSince,
    now,
  };
  return {
    name: 'payroll',
    routes: (requireRole) =>
      createPayrollRoutes(
        reads,
        validation,
        entries,
        rules,
        (userId, invoiceId, logger) => downloadInvoicePdf(pdfs, userId, invoiceId, logger),
        createPayrollInvoiceAcceptance(acceptanceStore),
        createPayrollAccounting(createDrizzlePayrollAccountingStore(deps.db, deps.reads), pdfs),
        requireRole,
      ),
    latestRate: createLatestRateRead(deps.db),
    jobs: {
      recalculate: (period, logger) => createRecalculation(jobStore, logger, now).recalculate(period),
      recalculateOpen: (logger) => createRecalculation(jobStore, logger, now).recalculateOpen(),
      fetchExchangeRates: (logger) => fetchExchangeRates(rateJob, logger),
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
