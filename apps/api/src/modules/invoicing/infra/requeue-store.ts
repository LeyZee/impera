import { CommissionStatementIdSchema } from '@nirvana/contracts';
import { and, eq, inArray, schema, sql, withAdmin, type Database } from '@nirvana/db';

import type { PayrollRequeueStore } from '../domain/ports';

import { enqueueInvoiceIssue } from './invoice-queue';

const { commissionStatements } = schema;

/**
 * `payroll.requeue_invoice_issues` as the jobs (`withAdmin`, which reads every member's statements and events): each
 * validated or paid statement of the contractor (of every one for `null`) for which `invoice_not_issued` was said gets
 * its `payroll.issue_invoices` again. That run issues only what is missing, and says only a new reason.
 */
export function createDrizzlePayrollRequeueStore(adminDb: Database): PayrollRequeueStore {
  return {
    requeueUnscoped: (memberId) =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({ id: commissionStatements.id })
          .from(commissionStatements)
          .where(
            and(
              inArray(commissionStatements.status, ['validated', 'paid']),
              memberId === null ? undefined : eq(commissionStatements.memberId, memberId),
              // Written out by hand: Drizzle prints a column of a single-table select without its table.
              sql`exists (select 1 from domain_events e where e.type = 'invoice_not_issued' and e.payload->>'statementId' = "commission_statements"."id"::text)`,
            ),
          )
          .orderBy(commissionStatements.period, commissionStatements.id);
        for (const row of rows) await enqueueInvoiceIssue(tx, CommissionStatementIdSchema.parse(row.id));
        return rows.length;
      }),
  };
}
