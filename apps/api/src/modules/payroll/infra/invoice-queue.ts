import {
  JOB_MAX_ATTEMPTS,
  type CommissionStatementId,
  type InvoiceId,
  type TeamMemberId,
} from '@nirvana/contracts';
import { sql, type Transaction } from '@nirvana/db';

/**
 * `payroll.issue_invoices` for a validated statement, once the transaction that validated it commits (EQ-06 lot 3).
 * Its key names the statement, so a statement waits in the queue once: a second enqueue (`enqueueInvoiceRequeue`: a file,
 * a prefix or a mandate that changed) replaces the waiting run, and the run itself issues only what is missing (each document has its
 * idempotency key). The issue is not in the validation's transaction: only the owner or the jobs write invoices, and a
 * manager validates too.
 */
export async function enqueueInvoiceIssue(
  tx: Transaction,
  statementId: CommissionStatementId,
): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'payroll.issue_invoices',
      payload => ${JSON.stringify({ statementId })}::jsonb,
      max_attempts => ${JOB_MAX_ATTEMPTS['payroll.issue_invoices']}::int,
      job_key => ${`payroll.issue_invoices:${statementId}`},
      job_key_mode => 'replace'
    )`,
  );
}

/**
 * `payroll.requeue_invoice_issues` once a contractor's file, prefix, check or mandate changes (his `memberId`), or the
 * agency's settings (`null`, every contractor), in the transaction that changes them (EQ-06 lot 5a): the statements
 * whose invoice waited are tried again once it commits. One key per contractor and one for all; a second change
 * replaces the waiting run, and a run never issues twice (each document has its key).
 */
export async function enqueueInvoiceRequeue(tx: Transaction, memberId: TeamMemberId | null): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'payroll.requeue_invoice_issues',
      payload => ${JSON.stringify({ memberId })}::jsonb,
      max_attempts => ${JOB_MAX_ATTEMPTS['payroll.requeue_invoice_issues']}::int,
      job_key => ${`payroll.requeue_invoice_issues:${memberId ?? 'all'}`},
      job_key_mode => 'replace'
    )`,
  );
}

/**
 * `payroll.render_invoice_pdf` for a document, in the transaction that issues it (ADR 0037 § 5): an issued document
 * always has its job. One key per document; the run renders only when its PDF has no row yet.
 */
export async function enqueueInvoicePdfRender(tx: Transaction, invoiceId: InvoiceId): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'payroll.render_invoice_pdf',
      payload => ${JSON.stringify({ invoiceId })}::jsonb,
      max_attempts => ${JOB_MAX_ATTEMPTS['payroll.render_invoice_pdf']}::int,
      job_key => ${`payroll.render_invoice_pdf:${invoiceId}`},
      job_key_mode => 'preserve_run_at'
    )`,
  );
}

/**
 * `payroll.mirror_invoice_pdf` for a document, in the transaction that writes its PDF's row (ADR 0037 § 6): a PDF
 * with a row always has its copy's job. One key per document; the run copies only what has no copy's row yet.
 */
export async function enqueueInvoicePdfMirror(tx: Transaction, invoiceId: string): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'payroll.mirror_invoice_pdf',
      payload => ${JSON.stringify({ invoiceId })}::jsonb,
      max_attempts => ${JOB_MAX_ATTEMPTS['payroll.mirror_invoice_pdf']}::int,
      job_key => ${`payroll.mirror_invoice_pdf:${invoiceId}`},
      job_key_mode => 'preserve_run_at'
    )`,
  );
}

/**
 * `payroll.lapse_invoice` for a document, to run at its deadline (EQ-06 lot 6, ADR 0039 § 1): enqueued in the
 * transaction that issues it, so an issued document always has its tacit acceptance waiting. One key per document; a
 * run that comes before the deadline puts it back there (`replace` moves the waiting run).
 */
export async function enqueueInvoiceLapse(tx: Transaction, invoiceId: string, deadline: Date): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'payroll.lapse_invoice',
      payload => ${JSON.stringify({ invoiceId })}::jsonb,
      run_at => ${deadline.toISOString()}::timestamptz,
      max_attempts => ${JOB_MAX_ATTEMPTS['payroll.lapse_invoice']}::int,
      job_key => ${`payroll.lapse_invoice:${invoiceId}`},
      job_key_mode => 'replace'
    )`,
  );
}

/**
 * `payroll.announce_invoice_contest` for a document, in the transaction that records its contest (ADR 0039 § 2): a
 * contest always has its alert's job. One key per document; the run says it once.
 */
export async function enqueueInvoiceContestAnnounce(tx: Transaction, invoiceId: InvoiceId): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'payroll.announce_invoice_contest',
      payload => ${JSON.stringify({ invoiceId })}::jsonb,
      max_attempts => ${JOB_MAX_ATTEMPTS['payroll.announce_invoice_contest']}::int,
      job_key => ${`payroll.announce_invoice_contest:${invoiceId}`},
      job_key_mode => 'preserve_run_at'
    )`,
  );
}
