import { CommissionStatementIdSchema } from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, type Database } from '@impera/db';

import { payReadsForInvoicing as payReads } from '../../payroll';
import type { PayrollRequeueStore } from '../domain/ports';

import { enqueueInvoiceIssue } from './invoice-queue';

const { domainEvents } = schema;

/**
 * `payroll.requeue_invoice_issues` as the jobs (`withAdmin`, which reads every member's statements and events): each
 * validated or paid statement of the contractor (of every one for `null`) for which `invoice_not_issued` was said gets
 * its `payroll.issue_invoices` again, in period order. That run issues only what is missing, and says only a new
 * reason. The events are read through their partial index (`domain_events_invoice_not_issued_idx`), only the
 * contractor's when one is named: the outbox grows, the blocked issues stay few.
 */
export function createDrizzlePayrollRequeueStore(adminDb: Database): PayrollRequeueStore {
  return {
    requeueUnscoped: (memberId) =>
      withAdmin(adminDb, async (tx) => {
        const said = await tx
          .selectDistinct({ statementId: sql<string | null>`${domainEvents.payload}->>'statementId'` })
          .from(domainEvents)
          .where(
            and(
              eq(domainEvents.type, 'invoice_not_issued'),
              memberId === null ? undefined : sql`${domainEvents.payload}->>'memberId' = ${memberId}`,
            ),
          );
        const ids = await payReads.issuedAmong(
          tx,
          said.flatMap((row) => (row.statementId === null ? [] : [row.statementId])),
          memberId,
        );
        for (const id of ids) await enqueueInvoiceIssue(tx, CommissionStatementIdSchema.parse(id));
        return ids.length;
      }),
  };
}
