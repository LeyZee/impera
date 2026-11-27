import { EVENT_PAYLOADS, type InvoiceNotIssuedReason } from '@impera/contracts';
import { and, eq, inArray, schema, sql } from '@impera/db';

import type { AfterValidation, PayoutGate, PayoutVerdict } from '../../payroll';
import { payoutDecision } from '../domain/payouts';

import { enqueueDocumentSettle, enqueueInvoiceIssue } from './invoice-queue';
import { payoutFactsOf } from './payout-facts';
import { invoiceGaps } from './readiness';

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

  // What stands now first (recette PARC-05): a past run's reason outlives what it said, the mandate published since or
  // the identity checked. Then through the events' partial index, by member: the newest said wins, its invoice's before
  // a credit note's of the same run; only a credit note no invoice can take is still worth saying once all is settled.
  async notIssuedReasonsUnscoped(adminTx, statements, day) {
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
    const said = new Map<string, InvoiceNotIssuedReason>();
    for (const row of rows) {
      const one = EVENT_PAYLOADS.invoice_not_issued.parse(row.payload);
      if (wanted.has(one.statementId) && !said.has(one.statementId)) said.set(one.statementId, one.reason);
    }
    const now = new Map<string, InvoiceNotIssuedReason | undefined>();
    for (const memberId of new Set(statements.map((one) => one.memberId))) {
      now.set(memberId, (await invoiceGaps(adminTx, memberId, day))[0]);
    }
    for (const { memberId, statementId } of statements) {
      const standing = now.get(memberId);
      const last = said.get(statementId);
      if (standing !== undefined) reasons.set(statementId, standing);
      else if (last === 'no_invoice_to_credit') reasons.set(statementId, last);
    }
    return reasons;
  },
};

/** The invoices' part of `AfterValidation` (ADR 0047 § 1): their issue and their settlement, in pay's transaction. */
export const invoicesAfterValidation: Pick<AfterValidation, 'issueInvoices' | 'settleDocuments'> = {
  issueInvoices: enqueueInvoiceIssue,
  settleDocuments: enqueueDocumentSettle,
};
