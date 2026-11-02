import type { TeamMemberId } from '@nirvana/contracts';
import type { Transaction } from '@nirvana/db';

/**
 * The ports of the contractors' file that take the transaction under way (ADR 0047 § 1): the composition root plugs
 * them (`wiring/contractors.ts`), never an import of the module that implements them. Each one reads and writes with
 * the caller's transaction, under its locks.
 */

/** What the contractors' file reads of the planning: the agency's time zone, which dates a file's day. */
export interface ContractorReads {
  readonly agencyTimeZone: (tx: Transaction) => Promise<string>;
}

/**
 * The invoices a change of the file may unblock (ADR 0047 § 1, `InvoiceRequeue`): a contractor's file, prefix, check,
 * mandate or regime, or the agency's billing settings, tries again the invoices that waited, once the transaction that
 * changes them commits. Never a file corrected without its retry.
 */
export interface InvoiceRequeue {
  /** Now, for one contractor, or every contractor (`null`: the agency's settings). */
  readonly requeue: (tx: Transaction, memberId: TeamMemberId | null) => Promise<void>;
  /** At `at`, the first minute of `day`: a regime given from a day to come is in force only then. */
  readonly requeueOn: (tx: Transaction, memberId: TeamMemberId, day: string, at: Date) => Promise<void>;
}
