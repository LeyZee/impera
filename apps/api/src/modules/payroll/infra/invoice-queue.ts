import { JOB_MAX_ATTEMPTS, type CommissionStatementId } from '@nirvana/contracts';
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
