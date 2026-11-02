import {
  AccountingPeriodQuerySchema,
  DAS2_WARNINGS,
  DEFAULT_FISCAL_YEAR_END_MONTH,
  type AccountingPeriodQuery,
  type Das2Warning,
  type JournalAccountName,
} from '@nirvana/contracts';

import { addDays } from '@/scheduling/time';

/**
 * The words of the accountant's exports (EQ-06 lot 8c): the names of the journal's accounts, the DAS2's warnings, the
 * fiscal years offered as a period. Nothing here computes what the server computes: the files and their numbers are
 * read as the API renders them.
 */

/** Each account and journal of the export, as Réglages › Facturation and the export's refusal name it. */
export const ACCOUNT_LABELS: Readonly<Record<JournalAccountName, string>> = {
  expense: 'Commissions (charges)',
  supplier: 'Fournisseurs (compte collectif)',
  vatDeductible: 'TVA déductible',
  vatSelfAssessedDeductible: 'TVA autoliquidée déductible',
  vatSelfAssessedDue: 'TVA autoliquidée due',
  bank: 'Banque',
  purchaseJournal: 'Journal des achats',
  bankJournal: 'Journal de banque',
};

/** What each one holds, in words only: no account is ever proposed, the accountant gives each. */
export const ACCOUNT_HINTS: Readonly<Record<JournalAccountName, string>> = {
  expense: 'Les commissions des prestataires, hors taxes.',
  supplier: 'Le compte de chaque prestataire est lui suivi de son préfixe.',
  vatDeductible: 'La TVA qu’un prestataire facture, que l’agence déduit.',
  vatSelfAssessedDeductible: 'Sous autoliquidation, la TVA que l’agence déduit.',
  vatSelfAssessedDue: 'Sous autoliquidation, la même TVA, que l’agence doit : jamais un compte déductible.',
  bank: 'Le compte d’où partent les virements.',
  purchaseJournal: 'Le code du journal des factures et des avoirs.',
  bankJournal: 'Le code du journal des virements, autre que celui des achats.',
};

/** The missing accounts a refusal names, in their one order, as a sentence. */
export function missingAccountsText(missing: readonly JournalAccountName[]): string {
  const names = missing.map((name) => ACCOUNT_LABELS[name].toLowerCase().replace(/^tva/u, 'TVA'));
  const list =
    names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} et ${names.at(-1) ?? ''}`;
  return missing.length === 1
    ? `Il manque un compte du journal : ${list}.`
    : `Il manque ${String(missing.length)} comptes du journal : ${list}.`;
}

/** The DAS2's warnings, in the glossary's words (« Récapitulatif DAS2 »), and what each asks of the accountant. */
export const DAS2_WARNING_LABELS: Readonly<Record<Das2Warning, string>> = {
  identity_missing: 'Identité absente',
  profile_changed: 'Dossier changé depuis',
  transfer_without_invoice: 'Virement sans facture',
  regimes_mixed: 'Régimes mêlés',
  vat_charged: 'TVA facturée, hors taxes versé',
};

export const DAS2_WARNING_TEXTS: Readonly<Record<Das2Warning, string>> = {
  identity_missing:
    'aucune facture ne donne son identité : un virement enregistré avant que le paiement attende sa facture.',
  profile_changed:
    'son dossier d’aujourd’hui diffère de l’identité que sa facture a figée ; le récapitulatif garde celle de la facture.',
  transfer_without_invoice:
    'un virement de l’année n’a payé aucune facture : il reste hors de la part sous convention.',
  regimes_mixed:
    'un virement a payé des factures sous deux régimes : il reste hors de la part sous convention.',
  vat_charged:
    'une facture payée portait de la TVA, mais le virement a envoyé le hors taxes du relevé ; la DAS2 attend la TVA comprise.',
};

/** The warnings a recap carries, each once, in the contract's order. */
export function warningsOf(
  beneficiaries: readonly { readonly warnings: readonly Das2Warning[] }[],
): Das2Warning[] {
  const present = new Set(beneficiaries.flatMap((one) => one.warnings));
  return DAS2_WARNINGS.filter((warning) => present.has(warning));
}

/** A range of days, both included, as the period fields hold it. */
export interface DayRange {
  readonly from: string;
  readonly to: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * The fiscal year in progress on `today`, up to `today`, and the one before it whole, from the month the agency's
 * fiscal year closes (Réglages › Facturation, December without it). A first fiscal year of up to 24 months is typed.
 */
export function fiscalYears(
  today: string,
  endMonth: number = DEFAULT_FISCAL_YEAR_END_MONTH,
): { readonly current: DayRange; readonly previous: DayRange } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  // The year the fiscal year in progress closes in, then its first day: the 1st of the month after the close.
  const closes = month <= endMonth ? year : year + 1;
  const start = endMonth === 12 ? `${String(closes)}-01-01` : `${String(closes - 1)}-${pad(endMonth + 1)}-01`;
  const startBefore = `${String(Number(start.slice(0, 4)) - 1)}${start.slice(4)}`;
  return {
    current: { from: start, to: today },
    previous: { from: startBefore, to: addDays(start, -1) },
  };
}

/** The range as the export asks for it, or the contract's own reason to refuse it (« Deux ans au plus »). */
export function periodQuery(
  range: DayRange,
):
  | { readonly ok: true; readonly query: AccountingPeriodQuery }
  | { readonly ok: false; readonly reason: string } {
  if (range.from === '' || range.to === '')
    return { ok: false, reason: 'Les deux jours, le premier et le dernier.' };
  const parsed = AccountingPeriodQuerySchema.safeParse(range);
  if (parsed.success) return { ok: true, query: parsed.data };
  const message = parsed.error.issues[0]?.message ?? 'Cette période ne convient pas';
  return { ok: false, reason: `${message}.` };
}

/** The years a DAS2 recap is asked for: this one and the nine before, the latest first. */
export function das2Years(today: string): number[] {
  const year = Number(today.slice(0, 4));
  return Array.from({ length: 10 }, (_unused, back) => year - back);
}

/** The name an archive downloads under: the server's (`content-disposition`), else the same one built here. */
export function archiveName(disposition: string | null, range: AccountingPeriodQuery): string {
  const named = disposition === null ? null : /filename="?([^";]+)"?/u.exec(disposition);
  const compact = (day: string): string => day.replaceAll('-', '');
  return named?.[1] ?? `pieces-prestataires_${compact(range.from)}_${compact(range.to)}.zip`;
}
