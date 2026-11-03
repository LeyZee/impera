import { AuditEntryIdSchema, InvoiceEventIdSchema, newId } from '@impera/contracts';
import { schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';

import type { PayrollSettlementStore } from '../domain/ports';
import { settlementsDue, type SettlementKind } from '../domain/settlements';

import { SETTLED, settlementFactsOf } from './settlement-rows';

const { auditLog, invoiceEvents, invoices } = schema;

/** The audit action of a settlement, by the document's kind. */
function actionOf(kind: SettlementKind, document: 'invoice' | 'credit_note'): string {
  if (kind === 'paid') return 'invoice.paid';
  if (kind === 'imputed') return 'credit_note.imputed';
  return `${document}.compensated`;
}

/** One contractor's settlements, under his lock: two runs at once write each settlement once. */
async function settleMember(tx: Transaction, memberId: string): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`payroll.settle:${memberId}`}, 0))`);
  const facts = (await settlementFactsOf(tx, [memberId])).get(memberId);
  if (facts === undefined) throw new Error('The contractor off the facts read');
  const byId = new Map(facts.documents.map((one) => [one.id, one]));
  const due = settlementsDue(facts.statements, facts.carryOvers, facts.documents);
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
