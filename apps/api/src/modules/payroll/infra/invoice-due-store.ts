import {
  AuditEntryIdSchema,
  calendarDayAt,
  EventIdSchema,
  EVENT_PAYLOADS,
  INVOICE_DUE_SOON_DAYS,
  newId,
  type PayoutBlock,
} from '@nirvana/contracts';
import { schema, sql, withAdmin, type Database, type Transaction } from '@nirvana/db';

import { addDays } from '../domain/billing';
import { invoiceDueState } from '../domain/invoices';
import { payoutDecision } from '../domain/payouts';
import type { PayrollInvoiceDueStore } from '../domain/ports';
import { payingStatement, settlementsDue } from '../domain/settlements';

import { payoutFactsOf } from './payout-facts';
import { SETTLED } from './settlement-rows';
import type { PayInputReads } from './snapshot';

const { auditLog, domainEvents, invoices } = schema;

/** The two alerts of an invoice's due date, each said once. */
type DueAlert = 'invoice_due_soon' | 'invoice_overdue';

/** Whether `type` was already said for this invoice, read under its lock. */
async function said(tx: Transaction, type: DueAlert, invoiceId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: domainEvents.id })
    .from(domainEvents)
    .where(
      // The index's predicate written out, its types as literals: the planner reads it through the partial index of 0059.
      sql`${domainEvents.type} in ('invoice_due_soon', 'invoice_overdue') and ${domainEvents.payload}->>'invoiceId' = ${invoiceId} and ${domainEvents.type} = ${type}`,
    )
    .limit(1);
  return row !== undefined;
}

/**
 * `payroll.remind_due_invoices` (EQ-06 lot 8): see `PayrollInvoiceDueStore`. One transaction for the run; each invoice
 * under its advisory lock, read then written, so that two runs at once say it once. An invoice whose transfer was
 * recorded but not reconciled yet is settled all the same (`settlementsDue`, what the reconciliation would write now):
 * it is never said. A member who left is still told about: the agency still owes his invoices.
 */
export function createDrizzleInvoiceDueStore(
  adminDb: Database,
  reads: Pick<PayInputReads, 'agencyTimeZone'>,
  now: () => Date,
): PayrollInvoiceDueStore {
  return {
    remindUnscoped: () =>
      withAdmin(adminDb, async (tx) => {
        const at = now();
        const today = calendarDayAt(at, await reads.agencyTimeZone(tx));
        // Invoices only (a credit note is taken off a transfer, never due), not settled, due within the week or past.
        const candidates = await tx
          .select({
            id: invoices.id,
            memberId: invoices.memberId,
            number: invoices.number,
            statementId: invoices.statementId,
            dueOn: invoices.dueOn,
            inclVatMinor: invoices.inclVatMinor,
          })
          .from(invoices)
          .where(
            // The outer table by hand: Drizzle writes a column of a one-table select without its table.
            sql`${invoices.kind} = 'invoice' and ${invoices.dueOn} <= ${addDays(today, INVOICE_DUE_SOON_DAYS)} and not exists (select 1 from ${schema.invoiceEvents} e where e.invoice_id = "invoices"."id" and e.kind in ${SETTLED})`,
          )
          // One order for every run: two runs at once take the invoices' locks in the same order.
          .orderBy(invoices.id);
        if (candidates.length === 0) return 0;
        const facts = await payoutFactsOf(tx, [...new Set(candidates.map((one) => one.memberId))]);
        const settledNow = new Set(
          [...facts.values()].flatMap((one) =>
            settlementsDue(one.statements, one.carryOvers, one.documents).map(
              (settled) => settled.documentId,
            ),
          ),
        );

        let count = 0;
        for (const invoice of candidates) {
          const state = invoiceDueState(
            { kind: 'invoice', dueOn: invoice.dueOn, settled: settledNow.has(invoice.id) },
            today,
          );
          if (state !== 'soon' && state !== 'overdue') continue;
          const type: DueAlert = state === 'soon' ? 'invoice_due_soon' : 'invoice_overdue';
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`invoice_due:${invoice.id}`}, 0))`,
          );
          if (await said(tx, type, invoice.id)) continue;
          const memberFacts = facts.get(invoice.memberId);
          if (memberFacts === undefined) throw new Error(`Invoice ${invoice.id} off the contractors read`);
          // What stops the transfer that will pay it, as pay would refuse it today (ADR 0041, the period's read too).
          const paying = payingStatement(memberFacts.statements, memberFacts.carryOvers, invoice);
          const decision = paying === null ? null : payoutDecision(memberFacts, paying.id, today);
          const payoutBlock: PayoutBlock | null =
            decision?.kind === 'blocked' ? { reason: decision.reason, year: decision.year } : null;
          const payload = EVENT_PAYLOADS[type].parse({
            invoiceId: invoice.id,
            memberId: invoice.memberId,
            number: invoice.number,
            dueOn: invoice.dueOn,
            inclVatMinor: invoice.inclVatMinor,
            payoutBlock,
          });
          await tx.insert(domainEvents).values({
            id: newId(EventIdSchema),
            creatorId: null,
            type,
            payload,
            actor: 'system',
            correlationId: `payroll.remind_due_invoices:${invoice.id}:${type}`,
            createdAt: at,
          });
          // Its dates and what blocks it, never a name.
          await tx.insert(auditLog).values({
            id: newId(AuditEntryIdSchema),
            userId: null,
            action: 'invoice.due_alert',
            entity: 'invoice',
            entityId: invoice.id,
            details: { memberId: invoice.memberId, alert: type, dueOn: invoice.dueOn, today, payoutBlock },
            ip: null,
          });
          count += 1;
        }
        return count;
      }),
  };
}
