import type {
  Das2Beneficiary,
  Das2Warning,
  InvoiceContractor,
  PayPeriod,
  TeamMemberId,
  Withholding,
} from '@impera/contracts';

import type { ContractorIdentity } from '../../contractors/pure';
import { settlementsDue, type SettlementCarryOver, type SettlementStatement } from '../../invoicing/pure';

/**
 * The yearly recap a DAS2 declares (EQ-06 lot 7c), the pure rules. The journal of the contractors' invoices and
 * transfers is `journal.ts`.
 */

/**
 * A DAS2 declares fees of more than 2 400 € paid to one beneficiary in the calendar year, what was paid with any VAT,
 * non-residents included (art. 240 of the CGI; doubled for sums paid from 2024, BOI-BIC-DECLA-30-70-20 § 140).
 */
const DAS2_THRESHOLD_MINOR = 240_000;

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

/** A statement as the recap reads it: the reconciliation's facts and its transfer, if any. */
export interface Das2Statement extends SettlementStatement {
  readonly payment: { readonly paidOn: string; readonly sentMinor: number } | null;
}

/** An issued document as the recap reads it: what it froze at its issue. */
export interface Das2Document {
  readonly id: string;
  readonly kind: 'invoice' | 'credit_note';
  readonly statementId: string | null;
  readonly period: PayPeriod;
  readonly issuedOn: string;
  readonly contractor: InvoiceContractor;
  readonly withholding: Withholding;
  readonly vatCharged: boolean;
}

/** One contractor's facts, all of them: a transfer of the year may pay documents of the year before. */
export interface Das2Contractor {
  readonly memberId: TeamMemberId;
  readonly statements: readonly Das2Statement[];
  readonly carryOvers: readonly SettlementCarryOver[];
  /** In the order of their numbers: the last is the latest issued. */
  readonly documents: readonly Das2Document[];
  /** Their file today, `null` when none is written. */
  readonly identityToday: ContractorIdentity | null;
}

/** The identity of the recap: the latest invoice of a period of the year, else the latest issued by the last transfer. */
function frozenIdentity(
  contractor: Das2Contractor,
  year: number,
  lastPaidOn: string,
): InvoiceContractor | null {
  const invoices = contractor.documents.filter((document) => document.kind === 'invoice');
  const ofTheYear = invoices.filter((document) => document.period.slice(0, 4) === String(year)).at(-1);
  return (
    (ofTheYear ?? invoices.filter((document) => document.issuedOn <= lastPaidOn).at(-1))?.contractor ?? null
  );
}

/** Whether the file today says something else than the frozen copy, on what the copy holds (an old copy holds less). */
function profileChanged(frozen: InvoiceContractor, today: ContractorIdentity): boolean {
  const differs = <T>(copied: T | undefined, now: T): boolean => copied !== undefined && copied !== now;
  return (
    frozen.legalName !== today.legalName ||
    frozen.address !== today.address ||
    frozen.country !== today.country ||
    frozen.taxId !== today.taxId ||
    differs(frozen.businessId, today.businessId) ||
    differs(frozen.vatNumber, today.vatNumber) ||
    differs(frozen.individualEntrepreneur, today.individualEntrepreneur) ||
    differs(frozen.legalForm, today.legalForm) ||
    differs(frozen.shareCapitalMinor, today.shareCapitalMinor) ||
    differs(frozen.rcsCity, today.rcsCity)
  );
}

const WARNING_ORDER: readonly Das2Warning[] = [
  'identity_missing',
  'profile_changed',
  'transfer_without_invoice',
  'regimes_mixed',
  'vat_charged',
];

/**
 * The beneficiaries of the year's DAS2, with what the accountant checks before declaring them:
 *
 * - **The sums**: what each transfer of the calendar year sent (`sentMinor`, by its `paidOn`), over 2 400 € only
 *   (`das2Beneficiaries`). A transfer is declared as it left, never recomputed: a contractor who charges VAT is paid
 *   what the statement says, excluding VAT (`vat_charged`, a point for the accountant).
 * - **The identity**: the one their latest invoice of a period of the year froze, else their latest invoice issued by
 *   the last transfer of the year; never their file of today, which may be changing and not checked yet. Their file is
 *   only compared with it (`profile_changed`). Without any invoice, `identity_missing`.
 * - **The treaty exemption**: the part sent by the transfers whose invoices were all frozen under a regime whose
 *   treaty sets the 182 B withholding aside (the reconciliation of lot 7a says which invoices a transfer paid). A
 *   transfer that paid none is left out (`transfer_without_invoice`), and so is one that paid invoices under both
 *   (`regimes_mixed`).
 *
 * Ordered by name, those without an identity last.
 */
export function das2Declaration(year: number, contractors: readonly Das2Contractor[]): Das2Beneficiary[] {
  const inYear = (day: string): boolean => day.slice(0, 4) === String(year);
  const over = das2Beneficiaries(
    year,
    contractors.flatMap((contractor) =>
      contractor.statements.flatMap((statement) =>
        statement.payment === null
          ? []
          : [
              {
                contractorId: contractor.memberId,
                paidOn: statement.payment.paidOn,
                sentMinor: statement.payment.sentMinor,
              },
            ],
      ),
    ),
  );
  const byMember = new Map<string, Das2Contractor>(
    contractors.map((contractor) => [contractor.memberId, contractor]),
  );
  const beneficiaries = over.flatMap(({ contractorId, paidMinor }): Das2Beneficiary[] => {
    const contractor = byMember.get(contractorId);
    if (contractor === undefined) return [];
    const byId = new Map(contractor.documents.map((document) => [document.id, document]));
    const paidBy = new Map<string, Das2Document[]>();
    const settlements = settlementsDue(
      contractor.statements,
      contractor.carryOvers,
      contractor.documents.map((document) => ({ ...document, settled: false })),
    );
    for (const settlement of settlements) {
      const document = byId.get(settlement.documentId);
      if (settlement.kind !== 'paid' || document === undefined) continue;
      paidBy.set(settlement.statementId, [...(paidBy.get(settlement.statementId) ?? []), document]);
    }

    const warnings = new Set<Das2Warning>();
    let treatyExemptMinor = 0;
    let lastPaidOn = '';
    for (const statement of contractor.statements) {
      const { payment } = statement;
      if (payment === null || !inYear(payment.paidOn)) continue;
      if (payment.paidOn > lastPaidOn) lastPaidOn = payment.paidOn;
      const invoices = paidBy.get(statement.id) ?? [];
      if (invoices.some((invoice) => invoice.vatCharged)) warnings.add('vat_charged');
      const withholdings = new Set(invoices.map((invoice) => invoice.withholding));
      if (invoices.length === 0) warnings.add('transfer_without_invoice');
      else if (withholdings.size > 1) warnings.add('regimes_mixed');
      else if (withholdings.has('treaty_exempt')) treatyExemptMinor += payment.sentMinor;
    }

    const identity = frozenIdentity(contractor, year, lastPaidOn);
    if (identity === null) warnings.add('identity_missing');
    else if (contractor.identityToday !== null && profileChanged(identity, contractor.identityToday))
      warnings.add('profile_changed');
    return [
      {
        memberId: contractor.memberId,
        identity,
        nature: 'commissions',
        paidMinor,
        treatyExemptMinor,
        warnings: WARNING_ORDER.filter((warning) => warnings.has(warning)),
      },
    ];
  });
  return beneficiaries.toSorted(
    (a, b) =>
      Number(a.identity === null) - Number(b.identity === null) ||
      (a.identity?.legalName ?? '').localeCompare(b.identity?.legalName ?? '', 'fr') ||
      a.memberId.localeCompare(b.memberId),
  );
}

/** Each warning as the accountant reads it in the file. */
const WARNING_WORDS: Readonly<Record<Das2Warning, string>> = {
  identity_missing: 'identité absente : aucune facture où la lire',
  profile_changed: 'dossier changé depuis la facture',
  transfer_without_invoice: 'virement sans facture',
  regimes_mixed: 'régimes mêlés dans un virement',
  vat_charged: 'TVA facturée, hors taxes versé',
};

const COLUMNS = [
  'Bénéficiaire',
  'Forme juridique',
  'Adresse',
  'Pays',
  'SIREN ou SIRET',
  'Identifiant fiscal',
  'Nature',
  'Montant versé',
  'Dont dispense conventionnelle',
  'Avertissements',
] as const;

/** An amount as a French spreadsheet reads it: euros with a decimal comma. */
function csvAmount(minor: number): string {
  return `${String(Math.trunc(minor / 100))},${String(minor % 100).padStart(2, '0')}`;
}

/**
 * A text cell: on one line, quoted when it holds the separator or a quote, and never read as a formula by a
 * spreadsheet (a leading `=`, `+`, `-` or `@` takes an apostrophe, OWASP « CSV injection »).
 */
function csvText(text: string): string {
  const line = text.replace(/\s*[\r\n]+\s*/gu, ', ').trim();
  const safe = /^[=+\-@]/u.test(line) ? `'${line}` : line;
  return /[;"]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * The recap's file (EQ-06 lot 7c): one line per beneficiary under the columns' names, separated by semicolons, lines
 * ended by CRLF, in UTF-8 with its byte order mark so that a spreadsheet reads its accents.
 */
export function das2Csv(beneficiaries: readonly Das2Beneficiary[]): string {
  const rows = beneficiaries.map((beneficiary) => {
    const identity = beneficiary.identity;
    const name =
      identity === null
        ? '(identité absente)'
        : `${identity.legalName}${identity.individualEntrepreneur === true ? ' EI' : ''}`;
    return [
      csvText(name),
      csvText(identity?.legalForm ?? ''),
      csvText(identity?.address ?? ''),
      csvText(identity?.country ?? ''),
      csvText(identity?.businessId ?? ''),
      csvText(identity?.taxId ?? ''),
      'Commissions',
      csvAmount(beneficiary.paidMinor),
      csvAmount(beneficiary.treatyExemptMinor),
      // Joined by a slash, not the separator: the cell needs no quotes.
      csvText(beneficiary.warnings.map((warning) => WARNING_WORDS[warning]).join(' / ')),
    ].join(';');
  });
  return `\uFEFF${[COLUMNS.join(';'), ...rows].join('\r\n')}\r\n`;
}

/** The recap's file name: the year, never another file's. */
export const das2FileName = (year: number): string => `das2-prestataires_${String(year)}.csv`;
