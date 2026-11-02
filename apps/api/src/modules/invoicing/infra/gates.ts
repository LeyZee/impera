import { sql, type Transaction } from '@nirvana/db';
import { z } from 'zod';

import type { AfterValidation, PayoutGate, PayoutVerdict } from '../../payroll';
import { payoutDecision } from '../domain/payouts';

import { enqueueDocumentSettle, enqueueInvoiceIssue } from './invoice-queue';
import { payoutFactsOf } from './payout-facts';

/**
 * `PayoutGate` (ADR 0047 § 1), which the composition root gives pay: what the invoices and the contractor's file say of
 * a transfer (ADR 0041), read in pay's transaction, one read per table whoever asks.
 */
export const payoutGate: PayoutGate = {
  async verdicts(tx, statements, paidOn) {
    const facts = await payoutFactsOf(
      tx,
      statements.map((one) => one.memberId),
    );
    const verdicts = new Map<string, PayoutVerdict>();
    for (const { memberId, statementId } of statements) {
      const of = facts.get(memberId);
      if (of === undefined) continue;
      const payout = payoutDecision(of, statementId, paidOn);
      verdicts.set(
        statementId,
        payout.kind === 'covered' ? { kind: 'covered', certificateId: payout.certificate.id } : payout,
      );
    }
    return verdicts;
  },

  // As the base's `keep_final_statement` counts them.
  async documentsOpen(tx: Transaction, memberId: string) {
    const [open] = await tx
      .execute<{ count: number }>(sql`select "member_documents_open"(${memberId}) as count`)
      .then((result) => z.array(z.object({ count: z.number().int() })).parse(result.rows));
    return open?.count ?? 0;
  },
};

/** The invoices' part of `AfterValidation` (ADR 0047 § 1): their issue and their settlement, in pay's transaction. */
export const invoicesAfterValidation: Pick<AfterValidation, 'issueInvoices' | 'settleDocuments'> = {
  issueInvoices: enqueueInvoiceIssue,
  settleDocuments: enqueueDocumentSettle,
};
