import type { Transaction } from '@nirvana/db';

/** What the exports read from another module, in their own transaction: the agency's time zone (`scheduling`). */
export interface AccountingReads {
  agencyTimeZone(tx: Transaction): Promise<string>;
}
