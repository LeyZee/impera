import type { CommissionStatementId, TeamMemberId } from '@impera/contracts';

import type { JobLogger } from '../../contractors/pure';
import { planInvoicing } from '../domain/invoicing';
import type { InvoicingOutcome, PayrollInvoiceStore, PayrollRequeueStore } from '../domain/ports';

/**
 * `payroll.issue_invoices` (EQ-06 lot 3): a validated statement's invoice and the credit notes its period owes, each
 * numbered and written in the store's one transaction. A document it cannot issue is said in the log and to the owner
 * (`invoice_not_issued`), never guessed; the statement stays validated.
 */
export async function issueInvoices(
  store: PayrollInvoiceStore,
  statementId: CommissionStatementId,
  logger: JobLogger,
): Promise<InvoicingOutcome> {
  const outcome = await store.issueUnscoped(statementId, planInvoicing);
  if (outcome.kind === 'not_validated') {
    logger.warn({ statementId }, 'payroll.issue_invoices: statement not validated, nothing issued');
    return outcome;
  }
  for (const warning of outcome.warnings) {
    logger.warn({ statementId, warning }, 'payroll.issue_invoices: invoice issued with a warning');
  }
  for (const one of outcome.notIssued) {
    logger.warn(
      { statementId, document: one.document, reason: one.reason, amountMinor: one.amountMinor },
      'payroll.issue_invoices: document not issued',
    );
  }
  return outcome;
}

/**
 * `payroll.requeue_invoice_issues` (EQ-06 lot 5a): once a contractor's file, prefix, check or mandate changes (or the
 * agency's settings, `null`), the statements whose invoice waited get their `payroll.issue_invoices` again. Returns how
 * many were enqueued.
 */
export function requeueInvoiceIssues(
  store: PayrollRequeueStore,
  memberId: TeamMemberId | null,
): Promise<number> {
  return store.requeueUnscoped(memberId);
}
