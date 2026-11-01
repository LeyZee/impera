import type {
  InvoiceAgency,
  InvoiceKind,
  InvoiceNotIssuedReason,
  InvoiceRegime,
  PayPeriod,
} from '@nirvana/contracts';

import {
  identityComplete,
  issueDecision,
  type ContractorDocument,
  type ContractorIdentity,
  type IssueWarning,
  type RegimeAssignment,
} from './billing';
import { acceptanceDeadline } from './invoice-acceptance';
import {
  creditNoteLines,
  creditNoteMention,
  creditsDue,
  invoiceDueOn,
  invoiceLines,
  invoiceTotals,
  paymentTermsMention,
  planCreditNotes,
  type CreditDue,
  type InvoiceLine,
  type InvoiceSource,
  type InvoiceTotals,
} from './invoices';

/**
 * What the validation of a statement issues (EQ-06 lot 3, ADR 0023 § Factures, ADR 0036), the pure plan: its invoice,
 * and the credit notes its period owes, each on the invoice that can take it whole. The job reads the facts, hands them
 * here, then numbers and writes each document in its one transaction. A document is named by its key: a rerun skips
 * what was issued and plans only what is missing.
 */

/** An issued invoice of the contractor, as a credit note cites it. */
export interface StoredInvoice {
  readonly id: string;
  readonly number: string;
  readonly period: PayPeriod;
  readonly issuedOn: string;
  readonly exclVatMinor: number;
  /** What its credit notes took off so far, a positive amount. */
  readonly creditedMinor: number;
  /** Its copy of its regime, mentions included, which a credit note keeps. */
  readonly regime: InvoiceRegime;
  readonly lines: readonly InvoiceLine[];
}

/** Everything the plan reads, as the job read it in its transaction. */
export interface InvoicingFacts {
  readonly statementId: string;
  readonly source: InvoiceSource;
  /** The instant of the issue, which starts the delay to contest. */
  readonly issuedAt: Date;
  /** The day of the issue in the agency's zone: the regime in force, the due date and the year of the number. */
  readonly issuedOn: string;
  readonly mandate: {
    /** The newest version of the mandate the contractor accepted, `null` for none. */
    readonly acceptedVersion: number | null;
    /** The agency's newest version, 0 before the first. */
    readonly currentVersion: number;
    /** The delay to contest of the version he accepted. */
    readonly contestDelayDays: number | null;
  };
  readonly assignments: readonly RegimeAssignment[];
  readonly regimes: readonly InvoiceRegime[];
  readonly identity: ContractorIdentity | null;
  readonly prefix: string | null;
  readonly documents: readonly ContractorDocument[];
  /** The agency's billing settings, `null` before the owner writes them. */
  readonly settings: {
    readonly agency: InvoiceAgency;
    /** What an invoice prints after its due date, the agency's words (a setting, never the code's). */
    readonly paymentTerms: string;
    readonly dueDays: number;
  } | null;
  /** The contractor's issued invoices (never his credit notes), what their credit notes took off counted. */
  readonly invoices: readonly StoredInvoice[];
  /** The keys of this statement's documents already issued. */
  readonly issuedKeys: ReadonlySet<string>;
}

/** A document to number and write, everything it prints computed once. */
export interface DocumentToIssue {
  /** Its idempotency key: the statement and the document, never twice. */
  readonly key: string;
  readonly kind: InvoiceKind;
  readonly creditedInvoiceId: string | null;
  /** The period of the service: the statement's for an invoice, the cited invoice's for a credit note. */
  readonly period: PayPeriod;
  readonly issuedOn: string;
  readonly dueOn: string;
  readonly contractor: ContractorIdentity;
  readonly agency: InvoiceAgency;
  readonly regime: InvoiceRegime;
  readonly mentions: readonly string[];
  readonly lines: readonly InvoiceLine[];
  readonly totals: InvoiceTotals;
  readonly acceptanceDeadline: Date;
}

/** A document due that is not issued, for the owner: the statement stays validated. */
export interface DocumentNotIssued {
  readonly document: InvoiceKind;
  readonly reason: InvoiceNotIssuedReason;
  /** What stays without a document, excluding VAT, positive. */
  readonly amountMinor: number;
}

export interface InvoicingPlan {
  /** The invoice first, then the credit notes in the order the period owes them. */
  readonly documents: readonly DocumentToIssue[];
  readonly notIssued: readonly DocumentNotIssued[];
  /** The amber warnings of the invoice, which goes out all the same. */
  readonly warnings: readonly IssueWarning[];
}

/** The key of a statement's invoice. */
export const invoiceKey = (statementId: string): string => `invoice:${statementId}`;

/** The key of the `index`-th credit note a statement's period owes, in the order of `creditsDue`. */
export const creditNoteKey = (statementId: string, index: number): string =>
  `credit:${statementId}:${String(index)}`;

const sum = (amounts: readonly number[]): number => amounts.reduce((total, one) => total + one, 0);

/**
 * The plan of a validated statement's documents. Its invoice, when its period brings something and nothing stops it
 * (`issueDecision`), under the contractor's regime of the day, his accepted mandate's delay and the agency's due delay.
 * Its mentions are its regime's, then its payment terms (art. L441-9 of the Code de commerce). Then each credit note
 * the period owes (`creditsDue`), on the invoice `planCreditNotes` finds for it: it keeps that invoice's period, regime
 * and the regime's mentions (ADR 0036), and prints the parties of the day and the invoice it cites. A due
 * no invoice can take whole is not issued, and neither is one without the agency's identity, the contractor's or a
 * mandate: each is said to the owner.
 */
export function planInvoicing(facts: InvoicingFacts): InvoicingPlan {
  const { statementId, source, issuedOn, issuedAt, settings, mandate } = facts;
  const documents: DocumentToIssue[] = [];
  const notIssued: DocumentNotIssued[] = [];
  const lines = invoiceLines(source);
  const exclVatMinor = sum(lines.map((line) => line.amountMinor));
  const decision = issueDecision({
    day: issuedOn,
    mandate,
    assignments: facts.assignments,
    regimes: facts.regimes,
    identity: facts.identity,
    prefix: facts.prefix,
    agency: settings?.agency ?? null,
    documents: facts.documents,
    exclVatMinor,
  });
  const deadline = (): Date | null =>
    mandate.contestDelayDays === null ? null : acceptanceDeadline(issuedAt, mandate.contestDelayDays);

  if (!facts.issuedKeys.has(invoiceKey(statementId))) {
    if (decision.kind === 'issue') {
      const regime = facts.regimes.find((one) => one.id === decision.regime.id);
      const until = deadline();
      if (
        regime === undefined ||
        settings === null ||
        facts.identity === null ||
        until === null ||
        facts.prefix === null
      ) {
        throw new Error('An invoice to issue without what its decision read');
      }
      const dueOn = invoiceDueOn(issuedOn, settings.dueDays);
      documents.push({
        key: invoiceKey(statementId),
        kind: 'invoice',
        creditedInvoiceId: null,
        period: source.period,
        issuedOn,
        dueOn,
        contractor: facts.identity,
        agency: settings.agency,
        regime,
        mentions: [...regime.mentions, paymentTermsMention(dueOn, settings.paymentTerms)],
        lines,
        totals: invoiceTotals(lines, regime.vat),
        acceptanceDeadline: until,
      });
    } else if (decision.reason !== 'nothing_to_invoice') {
      notIssued.push({ document: 'invoice', reason: decision.reason, amountMinor: exclVatMinor });
    }
  }

  const pending = creditsDue(source)
    .map((due, index) => ({ due, key: creditNoteKey(statementId, index) }))
    .filter((one) => !facts.issuedKeys.has(one.key));
  const keyOf = new Map<CreditDue, string>(pending.map((one) => [one.due, one.key]));
  const { notes, unplaced } = planCreditNotes(
    pending.map((one) => one.due),
    facts.invoices,
  );
  const credited = new Map(facts.invoices.map((one) => [one.id, one.creditedMinor]));
  for (const note of notes) {
    const cited = facts.invoices.find((one) => one.number === note.invoiceNumber);
    const key = keyOf.get(note.request);
    if (cited === undefined || key === undefined) throw new Error('A credit note planned off its invoices');
    const until = deadline();
    const identity = facts.identity;
    const skip = (reason: InvoiceNotIssuedReason): void => {
      notIssued.push({ document: 'credit_note', reason, amountMinor: note.request.amountMinor });
    };
    if (settings === null) {
      skip('agency_missing');
      continue;
    }
    if (!identityComplete(identity, cited.regime)) {
      skip('identity_incomplete');
      continue;
    }
    if (until === null) {
      skip('no_mandate');
      continue;
    }
    if (facts.prefix === null) {
      skip('prefix_missing');
      continue;
    }
    const creditedMinor = credited.get(cited.id) ?? 0;
    const noteLines = creditNoteLines(
      { lines: cited.lines, exclVatMinor: cited.exclVatMinor, creditedMinor },
      note.request,
    );
    credited.set(cited.id, creditedMinor + note.request.amountMinor);
    documents.push({
      key,
      kind: 'credit_note',
      creditedInvoiceId: cited.id,
      period: cited.period,
      issuedOn,
      dueOn: invoiceDueOn(issuedOn, settings.dueDays),
      contractor: identity,
      agency: settings.agency,
      regime: cited.regime,
      // The mentions of the regime it keeps, never the invoice's payment terms: a credit note is set off against a
      // payout, nothing falls due on it.
      mentions: [creditNoteMention(cited.number, cited.issuedOn), ...cited.regime.mentions],
      lines: noteLines,
      totals: invoiceTotals(noteLines, cited.regime.vat),
      acceptanceDeadline: until,
    });
  }
  for (const due of unplaced) {
    notIssued.push({ document: 'credit_note', reason: 'no_invoice_to_credit', amountMinor: due.amountMinor });
  }
  return { documents, notIssued, warnings: decision.warnings };
}
