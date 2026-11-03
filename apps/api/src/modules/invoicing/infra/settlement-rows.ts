import { CommissionStatementStatusSchema } from '@nirvana/contracts';
import { inArray, schema, sql, type Transaction } from '@nirvana/db';

import { payReadsForInvoicing as payReads } from '../../payroll';
import type { PayoutSettlementDocument } from '../domain/payouts';
import type { SettlementCarryOver, SettlementStatement } from '../domain/settlements';

const { invoiceEvents, invoices } = schema;

/** The kinds that settle a document, once (migration 0058's unique index). */
export const SETTLED = sql.raw(`('paid', 'imputed', 'compensated')`);

/** An issued document as the reconciliation reads it, with its number for the trail. */
interface SettlementRow extends PayoutSettlementDocument {
  readonly number: string;
}

/** One contractor's statements, carry-overs and issued documents, as the reconciliation walks them (lot 7a). */
export interface SettlementFacts {
  readonly statements: SettlementStatement[];
  readonly carryOvers: SettlementCarryOver[];
  readonly documents: SettlementRow[];
}

/**
 * The reconciliation's facts of each contractor of `memberIds`, one read per table whoever reads them: the job under
 * its lock (`withAdmin`), pay and the period's read through the policies (`withMember`). Pay's statements and
 * carry-overs come from pay (`payReadsForInvoicing`).
 */
export async function settlementFactsOf(
  tx: Transaction,
  memberIds: readonly string[],
): Promise<Map<string, SettlementFacts>> {
  const facts = new Map<string, SettlementFacts>(
    memberIds.map((id) => [id, { statements: [], carryOvers: [], documents: [] }]),
  );
  if (memberIds.length === 0) return facts;
  const of = (memberId: string): SettlementFacts => {
    const found = facts.get(memberId);
    if (found === undefined) throw new Error('A row off the contractors read');
    return found;
  };
  for (const one of await payReads.statementsOf(tx, memberIds)) {
    of(one.memberId).statements.push({
      id: one.id,
      period: one.period,
      status: CommissionStatementStatusSchema.parse(one.status),
      totalMinor: one.totalMinor,
    });
  }
  for (const one of await payReads.carryOversOf(tx, memberIds))
    of(one.memberId).carryOvers.push({ statementId: one.statementId, toPeriod: one.toPeriod });
  const documents = await tx
    .select({
      memberId: invoices.memberId,
      id: invoices.id,
      kind: invoices.kind,
      number: invoices.number,
      statementId: invoices.statementId,
      exclVatMinor: invoices.exclVatMinor,
      // The regime as the document froze it at its issue.
      underTreaty: sql<boolean>`(${invoices.regime} ->> 'withholding') = 'treaty_exempt'`,
      // The outer table by hand: Drizzle writes a column of a one-table select without its table.
      settled: sql<boolean>`exists (select 1 from ${invoiceEvents} e where e.invoice_id = "invoices"."id" and e.kind in ${SETTLED})`,
    })
    .from(invoices)
    .where(inArray(invoices.memberId, [...memberIds]));
  for (const one of documents) {
    of(one.memberId).documents.push({
      id: one.id,
      kind: one.kind === 'invoice' ? 'invoice' : 'credit_note',
      number: one.number,
      statementId: one.statementId,
      exclVatMinor: one.exclVatMinor,
      settled: one.settled,
      underTreaty: one.underTreaty,
    });
  }
  return facts;
}
