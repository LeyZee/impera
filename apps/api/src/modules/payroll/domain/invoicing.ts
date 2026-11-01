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
  taxResidenceFor,
  treatyNeedsResidence,
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
  reissueLines,
  reissueMention,
  reissuesDue,
  type CreditDue,
  type InvoiceLine,
  type InvoiceSource,
  type InvoiceTotals,
} from './invoices';

/**
 * What the validation of a statement issues (EQ-06 lot 3, ADR 0023 § Factures, ADR 0036, ADR 0040), the pure plan: its
 * invoice, the credit notes its period owes, each on the invoice that can take it whole, and the corrective invoice of
 * each cancel and reissue. The job reads the facts, hands them here, then numbers and writes all the documents in one
 * transaction. A document is named by its key: a rerun skips
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
  /** The ids of the regimes written for the country of his member record, as it reads at the issue. */
  readonly regimesOfCountry: ReadonlySet<string>;
  readonly identity: ContractorIdentity | null;
  /** The owner checked the file as it stands (`contractor_profiles.verified_at`). */
  readonly identityVerified: boolean;
  readonly prefix: string | null;
  readonly documents: readonly ContractorDocument[];
  /**
   * The agency's billing settings, `null` before the owner writes them, or while they lack the designation of the
   * service (`agency_missing`: an invoice without it would not say what it bills).
   */
  readonly settings: {
    readonly agency: InvoiceAgency;
    /** What an invoice prints after its due date, the agency's words (a setting, never the code's). */
    readonly paymentTerms: string;
    readonly dueDays: number;
    /** What each invoice designates above its lines, the agency's words. */
    readonly serviceDescription: string;
    /** The logo each document prints, by its fingerprint; `null` for none. */
    readonly logoSha256: string | null;
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
  /** The invoice a cancel and reissue cancels and bills again, on both its documents (ADR 0040); else `null`. */
  readonly reissuedInvoiceId: string | null;
  /**
   * The period of the service: the statement's for its invoice, the cited invoice's for a credit note or a corrective
   * invoice.
   */
  readonly period: PayPeriod;
  readonly issuedOn: string;
  readonly dueOn: string;
  readonly contractor: ContractorIdentity;
  readonly agency: InvoiceAgency;
  readonly regime: InvoiceRegime;
  readonly mentions: readonly string[];
  /** An invoice's designation of the service, a corrective one's too; `null` on a credit note, which cites its invoice. */
  readonly serviceDescription: string | null;
  readonly logoSha256: string | null;
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
  /**
   * The invoice first, then the credit notes in the order the period owes them, the cancel of each cancel and reissue
   * first and its corrective invoice right after it, numbered next.
   */
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

/** The key of the `index`-th corrective invoice a statement's period owes, in the order of `reissuesDue`. */
export const reissueKey = (statementId: string, index: number): string =>
  `reissue:${statementId}:${String(index)}`;

const sum = (amounts: readonly number[]): number => amounts.reduce((total, one) => total + one, 0);

/**
 * The plan of a validated statement's documents. Its invoice, when its period brings something and nothing stops it
 * (`issueDecision`), under the contractor's regime of the day, his accepted mandate's delay and the agency's due delay.
 * Its mentions are its regime's, then its payment terms (art. L441-9 of the Code de commerce). Then each credit note
 * the period owes (`creditsDue`), on the invoice `planCreditNotes` finds for it: it keeps that invoice's period, regime
 * and the regime's mentions (ADR 0036), and prints the parties of the day and the invoice it cites. A due
 * no invoice can take whole is not issued, and neither is one without the agency's identity, the contractor's (complete
 * and checked by the owner) or a mandate, nor a cancel whose corrective invoice waits for a tax residence certificate:
 * each is said to the owner. The cancel of a cancel and reissue leaves with its corrective invoice or not at
 * all (ADR 0039 § 3, ADR 0040): the corrective invoice bills the same amount again under the cancelled invoice's
 * period, regime and mentions, never the regime of the day, citing it first and ending with the payment terms; it
 * prints the parties, the designation and the terms of the day, which is the error of text it corrects.
 */
export function planInvoicing(facts: InvoicingFacts): InvoicingPlan {
  const { statementId, source, issuedOn, issuedAt, settings, mandate } = facts;
  const documents: DocumentToIssue[] = [];
  const notIssued: DocumentNotIssued[] = [];
  const lines = invoiceLines(source);
  const exclVatMinor = sum(lines.map((line) => line.amountMinor));
  const decision = issueDecision({
    day: issuedOn,
    period: source.period,
    mandate,
    assignments: facts.assignments,
    regimes: facts.regimes,
    regimesOfCountry: facts.regimesOfCountry,
    identity: facts.identity,
    identityVerified: facts.identityVerified,
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
        reissuedInvoiceId: null,
        period: source.period,
        issuedOn,
        dueOn,
        contractor: facts.identity,
        agency: settings.agency,
        regime,
        mentions: [...regime.mentions, paymentTermsMention(dueOn, settings.paymentTerms)],
        serviceDescription: settings.serviceDescription,
        logoSha256: settings.logoSha256,
        lines,
        totals: invoiceTotals(lines, regime.vat),
        acceptanceDeadline: until,
      });
    } else if (decision.reason !== 'nothing_to_invoice') {
      notIssued.push({ document: 'invoice', reason: decision.reason, amountMinor: exclVatMinor });
    }
  }

  // The cancel of each cancel and reissue is placed first: its amount is what its invoice had left when the contest was
  // upheld, and another due of the same period placed before it would leave it short. A cancel whose key is issued
  // went out with its corrective invoice, in one transaction. Each key stays its place in `creditsDue`.
  const pending = creditsDue(source)
    .map((due, index) => ({ due, key: creditNoteKey(statementId, index) }))
    .filter((one) => !facts.issuedKeys.has(one.key));
  const keyOf = new Map<CreditDue, string>(pending.map((one) => [one.due, one.key]));
  const cancelOf = (due: CreditDue): string | null => (due.kind === 'adjustment' ? due.reissueOf : null);
  const { notes, unplaced } = planCreditNotes(
    [
      ...pending.filter((one) => cancelOf(one.due) !== null),
      ...pending.filter((one) => cancelOf(one.due) === null),
    ].map((one) => one.due),
    facts.invoices,
  );
  // The corrective invoice of each cancel, by the invoice both name; one already issued is never planned again.
  const reissues = new Map(
    reissuesDue(source).map((due, index) => [due.invoiceId, { due, key: reissueKey(statementId, index) }]),
  );
  const reissueFor = (due: CreditDue) => {
    const invoiceId = cancelOf(due);
    if (invoiceId === null) return null;
    const reissue = reissues.get(invoiceId);
    if (reissue === undefined) throw new Error('A cancel without its corrective invoice');
    return facts.issuedKeys.has(reissue.key) ? null : reissue;
  };
  /** A due not issued, said to the owner, and with a cancel its corrective invoice, held for the same reason. */
  const hold = (due: CreditDue, reason: InvoiceNotIssuedReason): void => {
    notIssued.push({ document: 'credit_note', reason, amountMinor: due.amountMinor });
    const reissue = reissueFor(due);
    if (reissue !== null)
      notIssued.push({ document: 'invoice', reason, amountMinor: reissue.due.amountMinor });
  };
  const credited = new Map(facts.invoices.map((one) => [one.id, one.creditedMinor]));
  for (const note of notes) {
    const cited = facts.invoices.find((one) => one.number === note.invoiceNumber);
    const key = keyOf.get(note.request);
    if (cited === undefined || key === undefined) throw new Error('A credit note planned off its invoices');
    const until = deadline();
    const identity = facts.identity;
    if (settings === null) {
      hold(note.request, 'agency_missing');
      continue;
    }
    if (!identityComplete(identity, cited.regime)) {
      hold(note.request, 'identity_incomplete');
      continue;
    }
    // A credit note prints the parties of the day: never a file the owner has not checked as it stands.
    if (!facts.identityVerified) {
      hold(note.request, 'identity_unverified');
      continue;
    }
    // A corrective invoice bills again: under a treaty, it waits for the residence certificate of the year it bills,
    // and its cancel with it. A credit note alone pays nothing, and needs none.
    if (reissueFor(note.request) !== null && treatyNeedsResidence(cited.regime)) {
      const residence = taxResidenceFor(facts.documents, cited.period);
      if (residence !== 'covered') {
        hold(note.request, residence === 'missing' ? 'tax_residence_missing' : 'tax_residence_unverified');
        continue;
      }
    }
    if (until === null) {
      hold(note.request, 'no_mandate');
      continue;
    }
    if (facts.prefix === null) {
      hold(note.request, 'prefix_missing');
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
      reissuedInvoiceId: cancelOf(note.request),
      period: cited.period,
      issuedOn,
      dueOn: invoiceDueOn(issuedOn, settings.dueDays),
      contractor: identity,
      agency: settings.agency,
      regime: cited.regime,
      // The mentions of the regime it keeps, never the invoice's payment terms: a credit note is set off against a
      // payout, nothing falls due on it.
      mentions: [creditNoteMention(cited.number, cited.issuedOn), ...cited.regime.mentions],
      serviceDescription: null,
      logoSha256: settings.logoSha256,
      lines: noteLines,
      totals: invoiceTotals(noteLines, cited.regime.vat),
      acceptanceDeadline: until,
    });
    const reissue = reissueFor(note.request);
    if (reissue === null) continue;
    if (reissue.due.amountMinor !== note.request.amountMinor) {
      throw new Error('A corrective invoice that does not bill again what its cancel takes off');
    }
    const dueOn = invoiceDueOn(issuedOn, settings.dueDays);
    const lines = reissueLines(reissue.due);
    documents.push({
      key: reissue.key,
      kind: 'invoice',
      creditedInvoiceId: null,
      reissuedInvoiceId: cited.id,
      period: cited.period,
      issuedOn,
      dueOn,
      contractor: identity,
      agency: settings.agency,
      regime: cited.regime,
      mentions: [
        reissueMention(cited.number, cited.issuedOn),
        ...cited.regime.mentions,
        paymentTermsMention(dueOn, settings.paymentTerms),
      ],
      serviceDescription: settings.serviceDescription,
      logoSha256: settings.logoSha256,
      lines,
      totals: invoiceTotals(lines, cited.regime.vat),
      acceptanceDeadline: until,
    });
  }
  for (const due of unplaced) hold(due, 'no_invoice_to_credit');
  return { documents, notIssued, warnings: decision.warnings };
}
