import { JOB_MAX_ATTEMPTS, type CommissionStatementId, type InvoiceId } from '@nirvana/contracts';
import { sql, type Transaction } from '@nirvana/db';

/**
 * `payroll.issue_invoices` for a validated statement, once the transaction that validated it commits (EQ-06 lot 3).
 * Its key names the statement, so a statement waits in the queue once: a second enqueue (lot 5, a mandate accepted or a
 * regime validated) replaces the waiting run, and the run itself issues only what is missing (each document has its
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
