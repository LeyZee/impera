import {
  AuditEntryIdSchema,
  CommissionStatementIdSchema,
  DEFAULT_FISCAL_YEAR_END_MONTH,
  newId,
} from '@nirvana/contracts';
import { schema, sql, withAdmin, type Database } from '@nirvana/db';
import { z } from 'zod';

import type { PayoutCertificate, PayrollPayoutCertificateStore } from '../domain/ports';

const { auditLog, billingSettings } = schema;

/** The record of a transfer (`entry-store` pay) and the line that says its certificate was locked for it. */
const PAID = 'commission_statement.pay';
const LOCKED = 'commission_statement.certificate_locked';

const RowSchema = z.object({
  statement_id: CommissionStatementIdSchema,
  document_id: z.string(),
  storage_key: z.string(),
  paid_on: z.string(),
});

/**
 * `payroll.lock_payout_certificate` (ADR 0041 § 6): see `PayrollPayoutCertificateStore`. The certificate a transfer
 * relied on is read from the transfer's record, the only place that keeps it (no column, coordinator's agreement).
 */
export function createDrizzlePayoutCertificateStore(adminDb: Database): PayrollPayoutCertificateStore {
  return {
    toLockUnscoped: (statementId) =>
      withAdmin(adminDb, async (tx): Promise<PayoutCertificate[]> => {
        const one = statementId === null ? sql`` : sql`and a.entity_id = ${statementId}`;
        const found = await tx.execute(sql`
          select s.id as statement_id, d.id as document_id, d.storage_key, s.paid_on::text as paid_on
          from audit_log a
          join commission_statements s on s.id::text = a.entity_id
          join contractor_documents d on d.id::text = a.details ->> 'certificateDocumentId'
          where a.action = ${PAID} and a.entity = 'commission_statement' and s.status = 'paid' ${one}
            and not exists (
              select 1 from audit_log l
              where l.action = ${LOCKED} and l.entity = 'commission_statement' and l.entity_id = a.entity_id
            )
          order by s.paid_on, s.id`);
        const [settings] = await tx
          .select({ fiscalYearEndMonth: billingSettings.fiscalYearEndMonth })
          .from(billingSettings)
          .limit(1);
        const fiscalYearEndMonth = settings?.fiscalYearEndMonth ?? DEFAULT_FISCAL_YEAR_END_MONTH;
        return z
          .array(RowSchema)
          .parse(found.rows)
          .map((row) => ({
            statementId: row.statement_id,
            documentId: row.document_id,
            key: row.storage_key,
            paidOn: row.paid_on,
            fiscalYearEndMonth,
          }));
      }),

    // Under the transfer's lock: the job and the night's run at once write the line once.
    recordLockedUnscoped: (certificate, retainUntil) =>
      withAdmin(adminDb, async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`payroll.lock_payout_certificate:${certificate.statementId}`}, 0))`,
        );
        const said = await tx.execute(sql`
          select 1 from audit_log
          where action = ${LOCKED} and entity = 'commission_statement' and entity_id = ${certificate.statementId}`);
        if (said.rows.length > 0) return false;
        await tx.insert(auditLog).values({
          id: newId(AuditEntryIdSchema),
          userId: null,
          action: LOCKED,
          entity: 'commission_statement',
          entityId: certificate.statementId,
          details: { documentId: certificate.documentId, retainUntil: retainUntil.toISOString() },
          ip: null,
        });
        return true;
      }),
  };
}
