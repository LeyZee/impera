import type { InvoiceId, JournalAccounts, TeamMemberId } from '@impera/contracts';

import type { Actor } from '../../contractors/pure';
import type { StoredInvoicePdf } from '../../invoicing/pure';

import type { Das2Contractor } from './accounting';
import type { JournalContractor, TransferLeftOut } from './journal';

/** What the journal export reads (EQ-06 lot 7b): the accounts, and each contractor with a line in the range. */
export interface JournalFacts {
  readonly accounts: JournalAccounts | null;
  /** Each contractor with a document issued or a transfer made in the range, all their facts for the lettering. */
  readonly contractors: readonly JournalContractor[];
  /** The transfers in the range of a contractor with no document, hence no supplier account: left out of the file. */
  readonly transfersLeftOut: readonly TransferLeftOut[];
}

/** A document of the archive's range (EQ-06 lot 7d): what the manifest says of it, and its PDF once rendered. */
export interface ArchiveDocument {
  readonly invoiceId: InvoiceId;
  readonly memberId: TeamMemberId;
  readonly number: string;
  readonly kind: 'invoice' | 'credit_note';
  readonly corrective: boolean;
  readonly issuedOn: string;
  readonly pdf: StoredInvoicePdf | null;
}

/** What the DAS2 recap reads (EQ-06 lot 7c): each contractor with a transfer made in the year, all their facts. */
export interface Das2Facts {
  readonly contractors: readonly Das2Contractor[];
}

/**
 * The journal export (EQ-06 lot 7b), the owner's alone, under their member context (`withMember`). `render` makes the
 * file from the facts inside the transaction; the audit line is written only once it has, so a refused export leaves
 * none.
 */
export interface PayrollAccountingStore {
  exportJournal<T>(actor: Actor, from: string, to: string, render: (facts: JournalFacts) => T): Promise<T>;
  /**
   * The DAS2 recap of `year` (lot 7c), on the same terms: `render` makes it from each contractor paid in the year, and
   * the audit line counts the beneficiaries it declares, never a name.
   */
  exportDas2<T extends { readonly beneficiaries: readonly unknown[] }>(
    actor: Actor,
    year: number,
    render: (facts: Das2Facts) => T,
  ): Promise<T>;
  /**
   * The documents issued from `from` to `to` (lot 7d), by day of issue then number, for the owner alone. The archive
   * streams after the transaction: its audit line, the range and how many documents, is written here, when it starts.
   */
  archiveDocuments(actor: Actor, from: string, to: string): Promise<readonly ArchiveDocument[]>;
}
