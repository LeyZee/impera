import type { CommissionStatementId, PayPeriod, TeamMemberId } from '@impera/contracts';
import type { Transaction } from '@impera/db';

import type { Actor } from '../../contractors/pure';
import type { PayoutVerdict } from '../domain/ports';

/**
 * What pay asks of the invoices and the contractors' file before a transfer (ADR 0047 § 1): the composition root plugs
 * in `invoicing`'s, which this module never imports. Each call reads in the caller's transaction, under its locks.
 */
export interface PayoutGate {
  /**
   * Whether each statement of `statements` may be paid by a transfer dated `paidOn` (ADR 0041): its documents all
   * issued, and under a tax treaty the certificate of the transfer's year accepted. One read per table whoever asks.
   */
  verdicts(
    tx: Transaction,
    statements: readonly { readonly memberId: string; readonly statementId: string }[],
    paidOn: string,
  ): Promise<ReadonlyMap<string, PayoutVerdict>>;
  /** How many of the member's documents are open: issued and neither accepted, lapsed nor ended (ADR 0039 § 6). */
  documentsOpen(tx: Transaction, memberId: string): Promise<number>;
}

/**
 * What a validation or a transfer puts in the queue for the other modules, in its own transaction (ADR 0047 § 1): never
 * a statement validated without its invoices' job, never a transfer without its settlement's. The composition root
 * plugs in `invoicing` and `contractors`.
 */
export interface AfterValidation {
  /** `payroll.issue_invoices` for a validated statement. */
  issueInvoices(tx: Transaction, statementId: CommissionStatementId): Promise<void>;
  /** `payroll.settle_documents` for the contractor whose statement was validated or paid. */
  settleDocuments(tx: Transaction, memberId: string): Promise<void>;
  /** `payroll.lock_payout_certificate` for a paid statement whose transfer relied on a certificate (ADR 0041 § 6). */
  lockPayoutCertificate(tx: Transaction, statementId: CommissionStatementId): Promise<void>;
}

/** The correction of an upheld contest, as `invoicing` hands it to pay (ADR 0039 § 3). */
export interface ContestCorrectionInput {
  readonly memberId: TeamMemberId;
  /** The contested document each adjustment names. */
  readonly contestedInvoiceId: string;
  /** The statement of the period each adjustment corrects. */
  readonly correctsStatementId: string;
  /** In the order they are written. */
  readonly adjustments: readonly { readonly amountMinor: number; readonly reason: string }[];
}

/**
 * The adjustments of an upheld contest's correction, written by pay in the caller's transaction (ADR 0039 § 3, ADR 0047
 * § 1): on the member's first open period, as any adjustment (its locks, its recalculation, its line of `audit_log`).
 * Only pay writes `pay_adjustments`; `invoicing` calls it through `PayrollModule.correctContest`.
 */
export type ContestCorrectionWrite = (
  tx: Transaction,
  actor: Actor,
  correction: ContestCorrectionInput,
) => Promise<{ readonly period: PayPeriod; readonly adjustmentIds: readonly string[] }>;
