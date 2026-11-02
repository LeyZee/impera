import {
  JOURNAL_ACCOUNT_NAMES,
  type JournalAccountName,
  type JournalAccounts,
  type PayPeriod,
} from '@nirvana/contracts';

import {
  periodWords,
  type InvoiceTotals,
  type SettlementCarryOver,
  type SettlementStatement,
} from '../../payroll/pure';

/**
 * The accounting journal of the contractors (EQ-06 lot 7b; ADR 0023 « journal des achats, comptes paramétrables,
 * validés par le comptable »), the pure rules: one entry per invoice or credit note in the purchase journal, one per
 * transfer in the bank journal, on the accounts the accountant gives, and the lettering the reconciliation of lot 7a
 * allows. The FEC text is written from these entries (`fec.ts`).
 */

/** The accounts and journals of the export, every one given by the accountant: none is ever written in the code. */
export type LedgerAccounts = Readonly<Record<JournalAccountName, string>>;

/** The accounts of the export, or the names of those the accountant has not given yet: the export never guesses one. */
export function ledgerAccountsOf(
  accounts: JournalAccounts | null,
): { readonly accounts: LedgerAccounts } | { readonly missing: readonly JournalAccountName[] } {
  if (accounts === null) return { missing: JOURNAL_ACCOUNT_NAMES };
  const missing = JOURNAL_ACCOUNT_NAMES.filter((name) => accounts[name] === null);
  if (missing.length > 0) return { missing };
  const given = (name: JournalAccountName): string => accounts[name] ?? '';
  return {
    accounts: {
      expense: given('expense'),
      supplier: given('supplier'),
      vatDeductible: given('vatDeductible'),
      vatSelfAssessedDeductible: given('vatSelfAssessedDeductible'),
      vatSelfAssessedDue: given('vatSelfAssessedDue'),
      bank: given('bank'),
      purchaseJournal: given('purchaseJournal'),
      bankJournal: given('bankJournal'),
    },
  };
}

/** A statement as the journal reads it: the reconciliation's facts, the day its debt ended, and its transfer. */
export interface JournalStatement extends SettlementStatement {
  readonly period: PayPeriod;
  /** The day of its validation in the agency's zone, `null` for a draft. */
  readonly validatedOn: string | null;
  readonly payment: {
    readonly paidOn: string;
    readonly reference: string | null;
    readonly sentMinor: number;
  } | null;
}

/** An issued document as the journal reads it; a credit note's totals are negative. */
export interface JournalDocument {
  readonly kind: 'invoice' | 'credit_note';
  /** An invoice that bills again an invoice its cancel took off (ADR 0040). */
  readonly corrective: boolean;
  readonly number: string;
  readonly issuedOn: string;
  readonly statementId: string | null;
  readonly totals: InvoiceTotals;
}

/** One contractor's facts: the prefix of their numbers and their name, for their supplier account. */
export interface JournalContractor {
  readonly prefix: string;
  readonly name: string;
  readonly statements: readonly JournalStatement[];
  readonly carryOvers: readonly SettlementCarryOver[];
  readonly documents: readonly JournalDocument[];
}

/** A letter and the day the group it marks was settled. */
interface Lettering {
  readonly code: string;
  readonly on: string;
}

/** A line of an entry: an amount above zero is a debit, below zero a credit. */
interface JournalLine {
  readonly account: string;
  readonly accountLabel: string;
  readonly auxiliary: { readonly account: string; readonly label: string } | null;
  readonly amountMinor: number;
  readonly lettering: Lettering | null;
}

/** An entry: a document in the purchase journal, a transfer in the bank journal. Its lines add up to zero. */
export interface JournalEntry {
  readonly journal: 'purchases' | 'bank';
  readonly date: string;
  readonly pieceRef: string;
  readonly label: string;
  readonly lines: readonly JournalLine[];
}

/** A settled group whose lines do not add up to zero, left without a letter: the contractor and the period it ends. */
export interface UnbalancedGroup {
  readonly prefix: string;
  readonly period: PayPeriod;
}

const FIRST_LETTERED_YEAR = 2000;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * The letter of the group a statement ends, three capitals from its period: the same in every export, and one per
 * period for a contractor, who has one statement per period. « AAA » is the first fortnight of 2000.
 */
export function letteringCode(period: PayPeriod): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const index = (year - FIRST_LETTERED_YEAR) * 24 + (month - 1) * 2 + (period.slice(8, 10) === '16' ? 1 : 0);
  if (!Number.isInteger(index) || index < 0 || index >= LETTERS.length ** 3) {
    throw new RangeError(`No letter for the period ${period}`);
  }
  const at = (position: number): string =>
    LETTERS.charAt(Math.floor(index / LETTERS.length ** position) % 26);
  return `${at(2)}${at(1)}${at(0)}`;
}

/**
 * Whether `statement` ends the debts carried to it: paid, or validated at a cumulated total of zero (ADR 0038). A
 * statement validated below zero carries its total on, and its invoices' compensation (lot 7a) is lettered with the
 * group that ends further on, where the carried credit is used up.
 */
const ends = (statement: JournalStatement): boolean =>
  statement.status === 'paid' || (statement.status === 'validated' && statement.totalMinor === 0);

/**
 * The statement that ends the carry-over chain `statement` starts, or `null` while the chain waits: a statement still
 * to pay, a draft, or a carry-over whose next statement is not there yet.
 */
function endOfChain(
  statement: JournalStatement | undefined,
  byPeriod: ReadonlyMap<string, JournalStatement>,
  carriedTo: ReadonlyMap<string, string>,
): JournalStatement | null {
  const seen = new Set<string>();
  let current = statement;
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    if (ends(current)) return current;
    const toPeriod = carriedTo.get(current.id);
    current = toPeriod === undefined ? undefined : byPeriod.get(toPeriod);
  }
  return null;
}

const inRange = (day: string, from: string, to: string): boolean => day >= from && day <= to;

function documentLabel(document: JournalDocument): string {
  if (document.kind === 'credit_note') return `Avoir ${document.number}`;
  return document.corrective ? `Facture rectificative ${document.number}` : `Facture ${document.number}`;
}

/**
 * One contractor's entries dated from `from` to `to`, and their groups left without a letter.
 *
 * - **A document** (purchase journal, on its day of issue): the expense excluding VAT, the VAT the contractor charged
 *   on the deductible account, and under reverse charge the self-assessed VAT both deducted and owed; the contractor's
 *   supplier account takes the total including VAT. A credit note is the same entry the other way round.
 * - **A transfer** (bank journal, on its day): the contractor's supplier account is debited with what was sent, the bank
 *   credited. Its fee, if any, is not in Nirvana.
 * - **The lettering**: the documents of the statements a carry-over chain links, and the transfer of the statement that
 *   ends it, share its letter (`letteringCode`) and the day it ended (the transfer's, or the validation's of a zero
 *   total), when their supplier lines add up to zero. Otherwise they stay without a letter and the group is said: a
 *   contractor who charges VAT is invoiced including VAT but paid as the statement says.
 *
 * The letters are read on all the contractor's facts, whatever the range: a document of the range is lettered once the
 * chain it is on has ended, even after `to`.
 */
export function contractorJournal(
  contractor: JournalContractor,
  accounts: LedgerAccounts,
  from: string,
  to: string,
): { readonly entries: JournalEntry[]; readonly unbalanced: UnbalancedGroup[] } {
  const byId = new Map(contractor.statements.map((one) => [one.id, one]));
  const byPeriod = new Map(contractor.statements.map((one) => [one.period, one]));
  const carriedTo = new Map(contractor.carryOvers.map((one) => [one.statementId, one.toPeriod]));
  const supplier = { account: `${accounts.supplier}${contractor.prefix}`, label: contractor.name };

  const groups = new Map<string, { readonly end: JournalStatement; readonly documents: JournalDocument[] }>();
  for (const document of contractor.documents) {
    const end = endOfChain(
      document.statementId === null ? undefined : byId.get(document.statementId),
      byPeriod,
      carriedTo,
    );
    if (end === null) continue;
    const group = groups.get(end.id) ?? { end, documents: [] };
    group.documents.push(document);
    groups.set(end.id, group);
  }
  for (const statement of contractor.statements) {
    if (statement.payment !== null && !groups.has(statement.id))
      groups.set(statement.id, { end: statement, documents: [] });
  }

  const lettersOfDocuments = new Map<string, Lettering>();
  const lettersOfTransfers = new Map<string, Lettering>();
  const unbalanced: UnbalancedGroup[] = [];
  for (const { end, documents } of groups.values()) {
    const sentMinor = end.status === 'paid' ? (end.payment?.sentMinor ?? null) : 0;
    const on = end.status === 'paid' ? (end.payment?.paidOn ?? null) : end.validatedOn;
    const owedMinor = documents.reduce((total, document) => total + document.totals.inclVatMinor, 0);
    const touches =
      documents.some((document) => inRange(document.issuedOn, from, to)) ||
      (end.payment !== null && inRange(end.payment.paidOn, from, to));
    if (sentMinor === null || on === null || owedMinor !== sentMinor) {
      if (touches) unbalanced.push({ prefix: contractor.prefix, period: end.period });
      continue;
    }
    const lettering = { code: letteringCode(end.period), on };
    lettersOfTransfers.set(end.id, lettering);
    for (const document of documents) lettersOfDocuments.set(document.number, lettering);
  }

  const entries: JournalEntry[] = [];
  for (const document of contractor.documents) {
    if (!inRange(document.issuedOn, from, to)) continue;
    const { exclVatMinor, vatMinor, inclVatMinor, selfAssessedVatMinor } = document.totals;
    const lines: JournalLine[] = [
      {
        account: accounts.expense,
        accountLabel: 'Commissions des prestataires',
        auxiliary: null,
        amountMinor: exclVatMinor,
        lettering: null,
      },
    ];
    if (vatMinor !== 0) {
      lines.push({
        account: accounts.vatDeductible,
        accountLabel: 'TVA déductible sur services',
        auxiliary: null,
        amountMinor: vatMinor,
        lettering: null,
      });
    }
    if (selfAssessedVatMinor !== 0) {
      lines.push(
        {
          account: accounts.vatSelfAssessedDeductible,
          accountLabel: 'TVA déductible autoliquidée',
          auxiliary: null,
          amountMinor: selfAssessedVatMinor,
          lettering: null,
        },
        {
          account: accounts.vatSelfAssessedDue,
          accountLabel: 'TVA due autoliquidée',
          auxiliary: null,
          amountMinor: 0 - selfAssessedVatMinor,
          lettering: null,
        },
      );
    }
    lines.push({
      account: accounts.supplier,
      accountLabel: 'Fournisseurs',
      auxiliary: supplier,
      amountMinor: 0 - inclVatMinor,
      lettering: lettersOfDocuments.get(document.number) ?? null,
    });
    entries.push({
      journal: 'purchases',
      date: document.issuedOn,
      pieceRef: document.number,
      label: documentLabel(document),
      lines,
    });
  }
  for (const statement of contractor.statements) {
    const { payment } = statement;
    if (payment === null || !inRange(payment.paidOn, from, to)) continue;
    entries.push({
      journal: 'bank',
      date: payment.paidOn,
      pieceRef: payment.reference ?? `VIR-${contractor.prefix}-${statement.period}`,
      label: `Virement ${contractor.prefix}, quinzaine ${periodWords(statement.period)}`,
      lines: [
        {
          account: accounts.supplier,
          accountLabel: 'Fournisseurs',
          auxiliary: supplier,
          amountMinor: payment.sentMinor,
          lettering: lettersOfTransfers.get(statement.id) ?? null,
        },
        {
          account: accounts.bank,
          accountLabel: 'Banque',
          auxiliary: null,
          amountMinor: 0 - payment.sentMinor,
          lettering: null,
        },
      ],
    });
  }
  return { entries, unbalanced };
}

/**
 * The journal of every contractor from `from` to `to`: the entries by day, the purchase journal before the bank's on
 * the same day, then by piece; and the groups left without a letter, by contractor then period.
 */
export function journalEntries(
  contractors: readonly JournalContractor[],
  accounts: LedgerAccounts,
  from: string,
  to: string,
): { readonly entries: JournalEntry[]; readonly unbalanced: UnbalancedGroup[] } {
  const each = contractors.map((contractor) => contractorJournal(contractor, accounts, from, to));
  const order = { purchases: 0, bank: 1 } as const;
  return {
    entries: each
      .flatMap((one) => one.entries)
      .toSorted(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          order[a.journal] - order[b.journal] ||
          a.pieceRef.localeCompare(b.pieceRef),
      ),
    unbalanced: each
      .flatMap((one) => one.unbalanced)
      .toSorted((a, b) => a.prefix.localeCompare(b.prefix) || a.period.localeCompare(b.period)),
  };
}
