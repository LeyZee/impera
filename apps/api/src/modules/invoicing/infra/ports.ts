import type { Transaction } from '@nirvana/db';

/** What the invoices read of the planning, in their own transaction: the agency's time zone, which dates a document. */
export interface InvoicingReads {
  agencyTimeZone(tx: Transaction): Promise<string>;
}
