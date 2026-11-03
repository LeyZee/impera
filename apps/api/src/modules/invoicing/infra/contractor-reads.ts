import { eq, schema } from '@impera/db';

import type { ContractorInvoiceReads } from '../../contractors';

const { invoices } = schema;

/**
 * What the contractors' file reads of the invoices (ADR 0047 § 1, ARC-07), in the file's transaction: whether a
 * contractor has a document, which froze his prefix. The invoices alone read their tables.
 */
export const invoiceReadsForContractors: ContractorInvoiceReads = {
  hasDocument: async (tx, memberId) => {
    const [row] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.memberId, memberId))
      .limit(1);
    return row !== undefined;
  },
};
