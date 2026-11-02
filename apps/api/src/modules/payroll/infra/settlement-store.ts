import {
  AuditEntryIdSchema,
  CommissionStatementStatusSchema,
  InvoiceEventIdSchema,
  newId,
} from '@nirvana/contracts';
import { eq, schema, sql, withAdmin, type Database, type Transaction } from '@nirvana/db';

import type { PayrollSettlementStore } from '../domain/ports';
import { settlementsDue, type SettlementDocument, type SettlementKind } from '../domain/settlements';

const { auditLog, carryOvers, commissionStatements, invoiceEvents, invoices } = schema;

/** The kinds that settle a document, once (migration 0058's unique index). */
const SETTLED = sql.raw(`('paid', 'imputed', 'compensated')`);

/** The audit action of a settlement, by the document's kind. */
function actionOf(kind: SettlementKind, document: 'invoice' | 'credit_note'): string {
  if (kind === 'paid') return 'invoice.paid';
  if (kind === 'imputed') return 'credit_note.imputed';
  return `${document}.compensated`;
}

/** One contractor's settlements, under his lock: two runs at once write each settlement once. */
async function settleMember(tx: Transaction, memberId: string): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`payroll.settle:${memberId}`}, 0))`);
  const statements = await tx
    .select({
      id: commissionStatements.id,
      period: commissionStatements.period,
      status: commissionStatements.status,
      totalMinor: commissionStatements.totalMinor,
    })
    .from(commissionStatements)
    .where(eq(commissionStatements.memberId, memberId));
  const carried = await tx
    .select({ statementId: carryOvers.statementId, toPeriod: carryOvers.toPeriod })
    .from(carryOvers)
    .where(eq(carryOvers.memberId, memberId));
  const documents = await tx
    .select({
      id: invoices.id,
      kind: invoices.kind,
      number: invoices.number,
      statementId: invoices.statementId,
      // The outer table by hand: Drizzle writes a column of a one-table select without its table.
      settled: sql<boolean>`exists (select 1 from ${invoiceEvents} e where e.invoice_id = "invoices"."id" and e.kind in ${SETTLED})`,
    })
    .from(invoices)
    .where(eq(invoices.memberId, memberId));
  const kindOf = (one: { readonly kind: string }): SettlementDocument['kind'] =>
    one.kind === 'invoice' ? 'invoice' : 'credit_note';
  const byId = new Map(documents.map((one) => [one.id, { number: one.number, kind: kindOf(one) }]));
  const due = settlementsDue(
    statements.map((one) => ({
      id: one.id,
      period: one.period,
      status: CommissionStatementStatusSchema.parse(one.status),
      totalMinor: one.totalMinor,
    })),
    carried,
    documents.map((one): SettlementDocument => ({
      id: one.id,
      kind: kindOf(one),
      statementId: one.statementId,
      settled: one.settled,
    })),
  );
  for (const settlement of due) {
    const document = byId.get(settlement.documentId);
    if (document === undefined) throw new Error('A settlement off the documents read');
    await tx.insert(invoiceEvents).values({
      id: newId(InvoiceEventIdSchema),
      invoiceId: settlement.documentId,
      kind: settlement.kind,
      statementId: settlement.statementId,
      by: null,
    });
    // The document's number and the transfer's statement: the trail from the invoice down to the transfer (art. 289 VII).
    await tx.insert(auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId: null,
      action: actionOf(settlement.kind, document.kind),
      entity: 'invoice',
      entityId: settlement.documentId,
      details: { number: document.number, statementId: settlement.statementId },
      ip: null,
    });
  }
  return due.length;
}

/**
 * `payroll.settle_documents` (EQ-06 lot 7a): see `PayrollSettlementStore`. Each contractor in his own transaction: one
 * that fails leaves the others written, and the next run takes him again.
 */
export function createDrizzleSettlementStore(adminDb: Database): PayrollSettlementStore {
  return {
    settleUnscoped: async (memberId) => {
      const members =
        memberId !== null
          ? [memberId]
          : (
              await withAdmin(adminDb, (tx) =>
                tx
                  .selectDistinct({ memberId: invoices.memberId })
                  .from(invoices)
                  .where(
                    sql`not exists (select 1 from ${invoiceEvents} e where e.invoice_id = "invoices"."id" and e.kind in ${SETTLED})`,
                  ),
              )
            ).map((row) => row.memberId);
      let written = 0;
      for (const one of members) written += await withAdmin(adminDb, (tx) => settleMember(tx, one));
      return written;
    },
  };
}
