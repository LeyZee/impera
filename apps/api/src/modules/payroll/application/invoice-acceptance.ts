import type {
  ContestInvoiceBody,
  InvoiceAcceptanceView,
  InvoiceId,
  RefuseInvoiceContestBody,
  UserId,
} from '@nirvana/contracts';

import { InvoiceNotFound } from '../domain/errors';
import type { Actor, JobLogger, PayrollInvoiceAcceptanceStore } from '../domain/ports';

/**
 * A document's acceptance (EQ-06 lot 6, ADR 0039 § 1 to 3): the contractor alone answers « J'accepte » or « Je conteste »
 * with a reason before the deadline, to the second; the owner alone refuses a contest with a reason; the dated job
 * `payroll.lapse_invoice` accepts tacitly once the deadline has passed. Every write is dated in `invoice_events` and
 * `audit_log`; the same answer sent again gives back what was recorded, another one is a conflict (409).
 */
export interface PayrollInvoiceAcceptance {
  /** The document's acceptance and its steps, for whoever reads the document (its policy), else `invoice_not_found`. */
  read(userId: UserId, invoiceId: InvoiceId): Promise<InvoiceAcceptanceView>;
  accept(actor: Actor, invoiceId: InvoiceId): Promise<InvoiceAcceptanceView>;
  contest(actor: Actor, invoiceId: InvoiceId, body: ContestInvoiceBody): Promise<InvoiceAcceptanceView>;
  refuseContest(
    actor: Actor,
    invoiceId: InvoiceId,
    body: RefuseInvoiceContestBody,
  ): Promise<InvoiceAcceptanceView>;
}

export function createPayrollInvoiceAcceptance(
  store: PayrollInvoiceAcceptanceStore,
): PayrollInvoiceAcceptance {
  return {
    read: async (userId, invoiceId) => {
      const view = await store.read(userId, invoiceId);
      if (view === null) throw new InvoiceNotFound();
      return view;
    },
    accept: (actor, invoiceId) => store.answer(actor, invoiceId, { kind: 'accept' }),
    contest: (actor, invoiceId, body) =>
      store.answer(actor, invoiceId, { kind: 'contest', reason: body.reason }),
    refuseContest: (actor, invoiceId, body) => store.refuseContest(actor, invoiceId, body.reason),
  };
}

export type LapseOutcome = Awaited<ReturnType<PayrollInvoiceAcceptanceStore['lapseUnscoped']>>;

/**
 * `payroll.lapse_invoice`, enqueued at the issue with the deadline as its start: accepts tacitly a document left
 * without an answer. Rerun or run late, it does nothing once the document is answered; run early (another clock), it
 * waits for the deadline again under the same key.
 */
export async function lapseInvoice(
  store: PayrollInvoiceAcceptanceStore,
  invoiceId: InvoiceId,
  logger: JobLogger,
): Promise<LapseOutcome> {
  const outcome = await store.lapseUnscoped(invoiceId);
  if (outcome === 'not_found') {
    logger.warn({ invoiceId }, 'payroll.lapse_invoice: no such document, nothing written');
  }
  if (outcome === 'early') {
    logger.warn({ invoiceId }, 'payroll.lapse_invoice: run before the deadline, waits for it');
  }
  return outcome;
}

export type ContestAnnounceOutcome = Awaited<
  ReturnType<PayrollInvoiceAcceptanceStore['announceContestUnscoped']>
>;

/**
 * `payroll.announce_invoice_contest`, enqueued with the contest: publishes `invoice_contested` once per document, as the
 * system (`domain_events` is written as admin), without the reason nor a name (ADR 0039 § 2).
 */
export async function announceInvoiceContest(
  store: PayrollInvoiceAcceptanceStore,
  invoiceId: InvoiceId,
  logger: JobLogger,
): Promise<ContestAnnounceOutcome> {
  const outcome = await store.announceContestUnscoped(invoiceId);
  if (outcome === 'not_found' || outcome === 'not_contested') {
    logger.warn({ invoiceId, outcome }, 'payroll.announce_invoice_contest: nothing to announce');
  }
  return outcome;
}
