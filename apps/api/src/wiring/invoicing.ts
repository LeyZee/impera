import { JOB_MAX_ATTEMPTS, JOB_PAYLOADS } from '@nirvana/contracts';

import { defineTask } from '../jobs';
import { createInvoicingModule, type InvoicingModule } from '../modules/invoicing';
import type { PayrollModule } from '../modules/payroll';
import type { SchedulingModule } from '../modules/scheduling';

import type { InvoiceBuckets } from './contractors';
import type { Routes, Shared, TasksNamed } from './shared';

/**
 * The jobs the invoices carry (ADR 0047 § 1): their names stay `payroll.*`, since tasks already queued carry them, and
 * each has exactly one task, this file's.
 */
export type InvoicingJob =
  | 'payroll.issue_invoices'
  | 'payroll.requeue_invoice_issues'
  | 'payroll.render_invoice_pdf'
  | 'payroll.mirror_invoice_pdf'
  | 'payroll.lapse_invoice'
  | 'payroll.announce_invoice_contest'
  | 'payroll.sweep_invoice_acceptance'
  | 'payroll.remind_due_invoices'
  | 'payroll.settle_documents';

export interface WiredInvoicing {
  readonly module: InvoicingModule;
  readonly tasks: TasksNamed<InvoicingJob>;
  readonly routes: readonly Routes[];
}

/**
 * The invoices read the agency's time zone from the planning, and write an upheld contest's correction through pay
 * (`correctContest`), both from their `index.ts` (ADR 0047 § 1).
 */
export function wireInvoicing(
  shared: Shared,
  deps: {
    readonly scheduling: SchedulingModule;
    readonly payroll: PayrollModule;
    /** The invoices' fonts: the path depends on where the bundle runs, so `composition-root.ts` gives it. */
    readonly invoiceFontsDir: string;
    /** The invoices' two buckets, which `wireContractors` builds and the contractors' documents share. */
    readonly invoiceBuckets: InvoiceBuckets;
    /**
     * Tests set the invoices' clock here, to issue a document whose delay to answer is already over (EQ-06 lot 6); the
     * system's otherwise. The database keeps its own: every step of an acceptance is checked on `now()`.
     */
    readonly now?: () => Date;
  },
): WiredInvoicing {
  const { db, adminDb, logger, requireRole } = shared;
  const module = createInvoicingModule({
    db,
    adminDb,
    reads: { agencyTimeZone: deps.scheduling.pay.agencyTimeZone },
    payroll: deps.payroll,
    invoicePdfs: { fontsDir: deps.invoiceFontsDir, ...deps.invoiceBuckets },
    ...(deps.now !== undefined && { now: deps.now }),
  });
  return {
    module,
    tasks: {
      'payroll.issue_invoices': defineTask(
        'payroll.issue_invoices',
        JOB_PAYLOADS['payroll.issue_invoices'],
        logger,
        async (payload, context) => {
          const outcome = await module.jobs.issueInvoices(payload.statementId, context.logger);
          context.logger.info(
            outcome.kind === 'planned'
              ? {
                  statementId: payload.statementId,
                  issued: outcome.issued,
                  notIssued: outcome.notIssued.length,
                }
              : { statementId: payload.statementId, outcome: outcome.kind },
            'payroll: invoices issued',
          );
        },
      ),
      'payroll.requeue_invoice_issues': defineTask(
        'payroll.requeue_invoice_issues',
        JOB_PAYLOADS['payroll.requeue_invoice_issues'],
        logger,
        async (payload, context) => {
          const enqueued = await module.jobs.requeueInvoiceIssues(payload.memberId);
          context.logger.info(
            { memberId: payload.memberId, enqueued },
            'payroll: waiting invoices tried again',
          );
        },
      ),
      'payroll.render_invoice_pdf': defineTask(
        'payroll.render_invoice_pdf',
        JOB_PAYLOADS['payroll.render_invoice_pdf'],
        logger,
        async (payload, context) => {
          const outcome = await module.jobs.renderInvoicePdf(
            payload.invoiceId,
            { current: context.attempt, max: JOB_MAX_ATTEMPTS['payroll.render_invoice_pdf'] },
            context.logger,
          );
          context.logger.info({ invoiceId: payload.invoiceId, outcome }, 'payroll: invoice PDF rendered');
        },
      ),
      'payroll.mirror_invoice_pdf': defineTask(
        'payroll.mirror_invoice_pdf',
        JOB_PAYLOADS['payroll.mirror_invoice_pdf'],
        logger,
        async (payload, context) => {
          const outcome = await module.jobs.mirrorInvoicePdf(
            payload.invoiceId,
            { current: context.attempt, max: JOB_MAX_ATTEMPTS['payroll.mirror_invoice_pdf'] },
            context.logger,
          );
          context.logger.info({ invoiceId: payload.invoiceId, outcome }, 'payroll: invoice PDF copied');
        },
      ),
      'payroll.lapse_invoice': defineTask(
        'payroll.lapse_invoice',
        JOB_PAYLOADS['payroll.lapse_invoice'],
        logger,
        async (payload, context) => {
          const outcome = await module.jobs.lapseInvoice(payload.invoiceId, context.logger);
          context.logger.info({ invoiceId: payload.invoiceId, outcome }, 'payroll: invoice lapse checked');
        },
      ),
      'payroll.announce_invoice_contest': defineTask(
        'payroll.announce_invoice_contest',
        JOB_PAYLOADS['payroll.announce_invoice_contest'],
        logger,
        async (payload, context) => {
          const outcome = await module.jobs.announceInvoiceContest(payload.invoiceId, context.logger);
          context.logger.info(
            { invoiceId: payload.invoiceId, outcome },
            'payroll: invoice contest announced',
          );
        },
      ),
      'payroll.sweep_invoice_acceptance': defineTask(
        'payroll.sweep_invoice_acceptance',
        JOB_PAYLOADS['payroll.sweep_invoice_acceptance'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { outcome: await module.jobs.sweepInvoiceAcceptance(context.logger) },
            'payroll: invoice acceptance swept',
          );
        },
      ),
      'payroll.remind_due_invoices': defineTask(
        'payroll.remind_due_invoices',
        JOB_PAYLOADS['payroll.remind_due_invoices'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { said: await module.jobs.remindDueInvoices() },
            'payroll: due invoices reminded',
          );
        },
      ),
      'payroll.settle_documents': defineTask(
        'payroll.settle_documents',
        JOB_PAYLOADS['payroll.settle_documents'],
        logger,
        async (payload, context) => {
          const settled = await module.jobs.settleDocuments(payload.memberId);
          context.logger.info({ memberId: payload.memberId, settled }, 'payroll: documents settled');
        },
      ),
    },
    routes: [module.routes(requireRole)],
  };
}
