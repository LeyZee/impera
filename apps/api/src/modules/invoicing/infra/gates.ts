import { EVENT_PAYLOADS, type InvoiceNotIssuedReason } from '@impera/contracts';
import { and, eq, inArray, schema, sql, type Transaction } from '@impera/db';
import { z } from 'zod';

import type { AfterValidation, PayoutGate, PayoutVerdict } from '../../payroll';
import { payoutDecision } from '../domain/payouts';

import { enqueueDocumentSettle, enqueueInvoiceIssue } from './invoice-queue';
import { payoutFactsOf } from './payout-facts';

const { domainEvents } = schema;

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

  // Through the events' partial index, by member: the newest said wins, its invoice's before a credit note's of the same
  // run. A rerun says only a new reason (`publishNotIssued`), so the newest is the one in force.
  async notIssuedReasonsUnscoped(adminTx, statements) {
    const reasons = new Map<string, InvoiceNotIssuedReason>();
    if (statements.length === 0) return reasons;
    const wanted = new Set(statements.map((one) => one.statementId));
    const rows = await adminTx
      .select({ payload: domainEvents.payload })
      .from(domainEvents)
      .where(
        and(
          eq(domainEvents.type, 'invoice_not_issued'),
          // The member first, for the partial index; the statements then, so a long-standing member's other
          // fortnights are never read (Bilan's review of #528).
          inArray(sql<string>`${domainEvents.payload}->>'memberId'`, [
            ...new Set(statements.map((one) => one.memberId)),
          ]),
          inArray(sql<string>`${domainEvents.payload}->>'statementId'`, [...wanted]),
        ),
      )
      .orderBy(
        sql`${domainEvents.createdAt} desc, (${domainEvents.payload}->>'document' = 'invoice') desc, ${domainEvents.id} desc`,
      );
    for (const row of rows) {
      const said = EVENT_PAYLOADS.invoice_not_issued.parse(row.payload);
      if (wanted.has(said.statementId) && !reasons.has(said.statementId))
        reasons.set(said.statementId, said.reason);
    }
    return reasons;
  },
};

/** The invoices' part of `AfterValidation` (ADR 0047 § 1): their issue and their settlement, in pay's transaction. */
export const invoicesAfterValidation: Pick<AfterValidation, 'issueInvoices' | 'settleDocuments'> = {
  issueInvoices: enqueueInvoiceIssue,
  settleDocuments: enqueueDocumentSettle,
};
