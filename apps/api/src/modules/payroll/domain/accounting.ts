import type { InvoiceTotals } from './invoices';

/**
 * What the agency's accountant receives of the contractors' invoices (EQ-06, ADR 0023 § Factures), the pure rules: the
 * purchase journal of a period, with accounts the owner sets and the accountant validates, and the yearly sums a DAS2
 * declares. The CSV and the archive of PDFs are written elsewhere from these rows.
 */

/** An invoice or a credit note as the journal reads it; a credit note's totals are negative. */
export interface JournalDocument {
  readonly kind: 'invoice' | 'credit_note';
  readonly number: string;
  readonly issuedOn: string;
  readonly contractorName: string;
  readonly contractorPrefix: string;
  readonly totals: InvoiceTotals;
  readonly dueOn: string;
  readonly payment: { readonly paidOn: string; readonly reference: string | null } | null;
}

/** The accounts of the journal, as the accountant gives them (never written in the code). */
export interface JournalAccounts {
  readonly expense: string;
  /** Followed by the contractor's prefix: one supplier account per contractor. */
  readonly supplierPrefix: string;
  readonly vatDeductible: string;
  /** The VAT the agency owes under reverse charge, collected and deducted at once. */
  readonly vatSelfAssessed: string;
}

export interface PurchaseJournalRow {
  readonly kind: 'invoice' | 'credit_note';
  readonly issuedOn: string;
  readonly number: string;
  readonly contractor: string;
  readonly supplierAccount: string;
  readonly expenseAccount: string;
  readonly exclVatMinor: number;
  /** VAT the contractor charged, deducted by the agency. */
  readonly vatMinor: number;
  readonly vatAccount: string | null;
  /** VAT self-assessed under reverse charge: owed and deducted, the same amount. */
  readonly selfAssessedVatMinor: number;
  readonly selfAssessedVatAccount: string | null;
  readonly inclVatMinor: number;
  readonly dueOn: string;
  readonly paidOn: string | null;
  readonly paymentReference: string | null;
}

/** The purchase journal: one row per invoice or credit note, by day of issue then number. */
export function purchaseJournal(
  documents: readonly JournalDocument[],
  accounts: JournalAccounts,
): PurchaseJournalRow[] {
  return documents
    .map((document) => ({
      kind: document.kind,
      issuedOn: document.issuedOn,
      number: document.number,
      contractor: document.contractorName,
      supplierAccount: `${accounts.supplierPrefix}${document.contractorPrefix}`,
      expenseAccount: accounts.expense,
      exclVatMinor: document.totals.exclVatMinor,
      vatMinor: document.totals.vatMinor,
      vatAccount: document.totals.vatMinor === 0 ? null : accounts.vatDeductible,
      selfAssessedVatMinor: document.totals.selfAssessedVatMinor,
      selfAssessedVatAccount: document.totals.selfAssessedVatMinor === 0 ? null : accounts.vatSelfAssessed,
      inclVatMinor: document.totals.inclVatMinor,
      dueOn: document.dueOn,
      paidOn: document.payment?.paidOn ?? null,
      paymentReference: document.payment?.reference ?? null,
    }))
    .toSorted((a, b) => a.issuedOn.localeCompare(b.issuedOn) || a.number.localeCompare(b.number));
}

/** A DAS2 declares fees of more than 1 200 € paid to one beneficiary in the year, non-residents included. */
const DAS2_THRESHOLD_MINOR = 120_000;

export interface PaymentForDas2 {
  readonly contractorId: string;
  readonly paidOn: string;
  readonly sentMinor: number;
}

/** The beneficiaries of the year's DAS2: what each was paid in the calendar year, over the threshold only. */
export function das2Beneficiaries(
  year: number,
  payments: readonly PaymentForDas2[],
): { readonly contractorId: string; readonly paidMinor: number }[] {
  const totals = new Map<string, number>();
  for (const payment of payments) {
    if (payment.paidOn.slice(0, 4) !== String(year)) continue;
    totals.set(payment.contractorId, (totals.get(payment.contractorId) ?? 0) + payment.sentMinor);
  }
  return [...totals]
    .filter(([, paidMinor]) => paidMinor > DAS2_THRESHOLD_MINOR)
    .map(([contractorId, paidMinor]) => ({ contractorId, paidMinor }))
    .toSorted((a, b) => a.contractorId.localeCompare(b.contractorId));
}
