import { JOB_MAX_ATTEMPTS, JOB_PAYLOADS } from '@nirvana/contracts';

import { invoiceBucket, type Config } from '../config';
import { defineTask } from '../jobs';
import {
  createMemoryInvoiceStore,
  createPayrollModule,
  createS3InvoiceStore,
  type InvoiceObjectStore,
  type PayrollModule,
} from '../modules/payroll';
import type { PersonaModule } from '../modules/persona';
import type { SchedulingModule } from '../modules/scheduling';
import type { TeamModule } from '../modules/team';

import type { Routes, Shared, TasksOf } from './shared';

/** The invoices' two buckets (ADR 0037 § 4 and § 6). */
export interface InvoiceBuckets {
  readonly primary: InvoiceObjectStore;
  readonly copy: InvoiceObjectStore;
}

/**
 * The configured buckets (always in production, `loadConfig` refuses to start without), or one store in memory each,
 * shared by the API and its inline worker, lost with the process: `volatile`, so that a PDF forgotten by a restart is
 * never alerted as a damaged one.
 */
function invoiceBuckets(config: Config): InvoiceBuckets {
  const primary = invoiceBucket(config, 'primary');
  const copy = invoiceBucket(config, 'copy');
  return {
    primary: primary === null ? createMemoryInvoiceStore({ volatile: true }) : createS3InvoiceStore(primary),
    copy: copy === null ? createMemoryInvoiceStore({ volatile: true }) : createS3InvoiceStore(copy),
  };
}

export interface WiredPayroll {
  readonly module: PayrollModule;
  readonly tasks: TasksOf<'payroll'>;
  readonly routes: readonly Routes[];
}

/** Pay reads the planning's reports and the team's rates in its own transaction, through their `index.ts` (EQ-04). */
export function wirePayroll(
  shared: Shared,
  deps: {
    readonly persona: PersonaModule;
    readonly scheduling: SchedulingModule;
    readonly team: TeamModule;
    /** When the rate job was first scheduled, in production only (ADR 0033): `composition-root.ts`. */
    readonly rateJobSince: (() => Promise<Date | null>) | null;
    /** The invoices' fonts: the path depends on where the bundle runs, so `composition-root.ts` gives it. */
    readonly invoiceFontsDir: string;
    /** Tests plug the invoices' two buckets here, to read what the jobs wrote; the configuration's otherwise. */
    readonly invoiceBuckets?: InvoiceBuckets;
    /**
     * Tests set pay's clock here, to issue a document whose delay to answer is already over (EQ-06 lot 6); the
     * system's otherwise. The database keeps its own: every step of an acceptance is checked on `now()`.
     */
    readonly now?: () => Date;
  },
): WiredPayroll {
  const { config, db, adminDb, logger, requireRole } = shared;
  const { scheduling, team, persona } = deps;
  const module = createPayrollModule({
    db,
    adminDb,
    reads: {
      validatedReportsUnscoped: scheduling.pay.validatedReportsUnscoped,
      validatedReportsScoped: scheduling.pay.validatedReportsScoped,
      reportsAwaitingReviewScoped: scheduling.pay.reportsAwaitingReviewScoped,
      agencyTimeZone: scheduling.pay.agencyTimeZone,
      members: team.pay.members,
      creatorIds: async () => (await persona.creators.list('all')).map((creator) => creator.id),
    },
    rateJobSince: deps.rateJobSince,
    invoicePdfs: { fontsDir: deps.invoiceFontsDir, ...(deps.invoiceBuckets ?? invoiceBuckets(config)) },
    ...(deps.now !== undefined && { now: deps.now }),
  });
  return {
    module,
    tasks: {
      'payroll.recalculate': defineTask(
        'payroll.recalculate',
        JOB_PAYLOADS['payroll.recalculate'],
        logger,
        async (payload, context) => {
          context.logger.info(
            { outcomes: await module.jobs.recalculate(payload.period, context.logger) },
            'payroll: drafts computed',
          );
        },
      ),
      'payroll.recalculate_open': defineTask(
        'payroll.recalculate_open',
        JOB_PAYLOADS['payroll.recalculate_open'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { outcomes: await module.jobs.recalculateOpen(context.logger) },
            'payroll: open periods computed',
          );
        },
      ),
      'payroll.fetch_exchange_rates': defineTask(
        'payroll.fetch_exchange_rates',
        JOB_PAYLOADS['payroll.fetch_exchange_rates'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { outcome: await module.jobs.fetchExchangeRates(context.logger) },
            'payroll: exchange rates read',
          );
        },
      ),
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
      'payroll.remind_documents': defineTask(
        'payroll.remind_documents',
        JOB_PAYLOADS['payroll.remind_documents'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { reminded: await module.jobs.remindDocuments() },
            'payroll: expiring documents reminded',
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
      'payroll.purge_refused_documents': defineTask(
        'payroll.purge_refused_documents',
        JOB_PAYLOADS['payroll.purge_refused_documents'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { outcome: await module.jobs.purgeRefusedDocuments(context.logger) },
            'payroll: refused documents purged',
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
      'payroll.lock_payout_certificate': defineTask(
        'payroll.lock_payout_certificate',
        JOB_PAYLOADS['payroll.lock_payout_certificate'],
        logger,
        async (payload, context) => {
          const locked = await module.jobs.lockPayoutCertificates(payload.statementId, context.logger);
          context.logger.info(
            { statementId: payload.statementId, locked },
            'payroll: payout certificates locked',
          );
        },
      ),
    },
    routes: [module.routes(requireRole)],
  };
}
