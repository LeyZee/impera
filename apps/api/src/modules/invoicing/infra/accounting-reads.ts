import { inArray, schema, sql, type Transaction } from '@impera/db';

const { invoicePdfCopies, invoicePdfs, invoices } = schema;

type InvoiceRow = typeof invoices.$inferSelect;

/** A document as the exports read it: its number, its totals and what it froze at its issue. */
export type DocumentForAccounting = Pick<
  InvoiceRow,
  | 'memberId'
  | 'id'
  | 'kind'
  | 'reissuedInvoiceId'
  | 'number'
  | 'prefix'
  | 'year'
  | 'sequence'
  | 'issuedOn'
  | 'statementId'
  | 'period'
  | 'exclVatMinor'
  | 'vatMinor'
  | 'inclVatMinor'
  | 'selfAssessedVatMinor'
  | 'contractor'
  | 'regime'
>;

/** The documents of a range for the archive, with their PDF rows and copy rows. */
export interface ArchiveRows {
  readonly rows: Pick<InvoiceRow, 'id' | 'memberId' | 'number' | 'kind' | 'reissuedInvoiceId' | 'issuedOn'>[];
  readonly pdfs: (typeof invoicePdfs.$inferSelect)[];
  readonly copies: (typeof invoicePdfCopies.$inferSelect)[];
}

/**
 * What the accountant's exports read of the invoices (ADR 0047 § 1, ARC-07), in the export's transaction (`withMember`,
 * the owner): the documents, what they froze at their issue, and their PDF with its copies. The invoices alone read
 * their tables.
 */
export const invoiceReadsForAccounting = {
  /** The members with a document issued from `from` to `to`, both days included. */
  issuedBetween: async (tx: Transaction, from: string, to: string): Promise<string[]> => {
    const rows = await tx
      .selectDistinct({ memberId: invoices.memberId })
      .from(invoices)
      .where(sql`${invoices.issuedOn} between ${from} and ${to}`);
    return rows.map((row) => row.memberId);
  },

  /** Every document of these members, whatever its day, in the order of their numbers. */
  documentsOf: (tx: Transaction, memberIds: readonly string[]): Promise<DocumentForAccounting[]> =>
    tx
      .select({
        memberId: invoices.memberId,
        id: invoices.id,
        kind: invoices.kind,
        reissuedInvoiceId: invoices.reissuedInvoiceId,
        number: invoices.number,
        prefix: invoices.prefix,
        year: invoices.year,
        sequence: invoices.sequence,
        issuedOn: invoices.issuedOn,
        statementId: invoices.statementId,
        period: invoices.period,
        exclVatMinor: invoices.exclVatMinor,
        vatMinor: invoices.vatMinor,
        inclVatMinor: invoices.inclVatMinor,
        selfAssessedVatMinor: invoices.selfAssessedVatMinor,
        contractor: invoices.contractor,
        regime: invoices.regime,
      })
      .from(invoices)
      .where(inArray(invoices.memberId, [...memberIds]))
      .orderBy(invoices.year, invoices.sequence),

  /** The documents issued from `from` to `to`, by day, prefix and number, with their PDF and copies once written. */
  archiveBetween: async (tx: Transaction, from: string, to: string): Promise<ArchiveRows> => {
    const rows = await tx
      .select({
        id: invoices.id,
        memberId: invoices.memberId,
        number: invoices.number,
        kind: invoices.kind,
        reissuedInvoiceId: invoices.reissuedInvoiceId,
        issuedOn: invoices.issuedOn,
      })
      .from(invoices)
      .where(sql`${invoices.issuedOn} between ${from} and ${to}`)
      .orderBy(invoices.issuedOn, invoices.prefix, invoices.year, invoices.sequence);
    if (rows.length === 0) return { rows, pdfs: [], copies: [] };
    const ids = rows.map((row) => row.id);
    const pdfs = await tx.select().from(invoicePdfs).where(inArray(invoicePdfs.invoiceId, ids));
    const copies = await tx
      .select()
      .from(invoicePdfCopies)
      .where(inArray(invoicePdfCopies.invoiceId, ids))
      .orderBy(invoicePdfCopies.provider);
    return { rows, pdfs, copies };
  },
};
