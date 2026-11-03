import type { ContractorDocumentKind, ContractorDocumentReview, RegimeVat } from '@impera/contracts';

import { BillingRegimeBackdated } from './errors';

/**
 * What a contractor's invoice needs before it is issued (EQ-06, ADR 0023 § Factures), the pure rules: the billing regime
 * of a contractor on a day, how long a document of the regime holds, and whether the validation of a statement issues an
 * invoice, with what warnings. Nothing here reads the database nor writes an invoice. How VAT goes on an invoice
 * (`RegimeVat`) and the documents a regime asks for are the contracts' (`invoices.ts`), shared with the base's checks.
 */

/**
 * A billing regime, as the owner sets it and the accountant validates it: copied into each invoice it covers. Its
 * mentions are its own text, never the code's.
 */
export interface BillingRegime {
  readonly id: string;
  readonly vat: RegimeVat;
  /** The 182 B withholding: set aside by the tax treaty with the contractor's country, or not due at all. */
  readonly withholding: 'treaty_exempt' | 'none';
  /** Printed as written on each invoice, in this order. */
  readonly mentions: readonly string[];
  readonly documents: readonly ContractorDocumentKind[];
  /**
   * The contractor's tax identifier is a mention of the regime (the IFU in Benin, the NIF in Madagascar). In France, the
   * SIREN or SIRET is asked by the code whatever the regime (`identityComplete`).
   */
  readonly taxIdRequired: boolean;
  /** The day the accountant validated it; a regime not validated issues no invoice. */
  readonly validatedOn: string | null;
}

/** A contractor's regime from a day on: a change applies from a date, never backwards. */
export interface RegimeAssignment {
  readonly regimeId: string;
  readonly from: string;
}

/** The regime in force for a contractor on `day`, `null` before the first one. */
export function regimeOn(assignments: readonly RegimeAssignment[], day: string): RegimeAssignment | null {
  let found: RegimeAssignment | null = null;
  for (const one of assignments) {
    if (one.from <= day && (found === null || one.from > found.from)) found = one;
  }
  return found;
}

/**
 * A new regime for a contractor starts today at the earliest, and after the last one: an invoice already issued keeps
 * the regime it was issued under (a franchise passed in the year changes from that day on).
 */
export function assertRegimeChange(
  assignments: readonly RegimeAssignment[],
  next: RegimeAssignment,
  today: string,
): void {
  const last = assignments.reduce<string | null>(
    (max, one) => (max === null || one.from > max ? one.from : max),
    null,
  );
  if (next.from < today || (last !== null && next.from <= last)) throw new BillingRegimeBackdated(next.from);
}

/** A document of the contractor's file, as filed, with the owner's check of it. */
export interface ContractorDocument {
  readonly kind: ContractorDocumentKind;
  readonly issuedOn: string;
  /** The end the document states, when it states one; else its kind decides. */
  readonly validUntil: string | null;
  /** The owner's check (lot 5c): `accepted`, `refused` with its reason, `null` while it waits. */
  readonly review: ContractorDocumentReview | null;
}

/** How long a vigilance certificate holds from its issue when it states no end: six months (art. D8222-5 du Code du travail). */
const VIGILANCE_MONTHS = 6;

/** `day` plus `months`, on the same date or the month's last one (31 August plus six months is 28 or 29 February). */
export function addMonths(day: string, months: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return target.toISOString().slice(0, 10);
}

/** `day` plus `days` calendar days. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The last day a document holds: the end it states; else, for a tax residence certificate, the 31st of December of the
 * year it was issued (the Beninese tax office issues it for the calendar year, and French doctrine reads it so,
 * BOI-INT-DG-20-20-20-20 § 200; « ok année civile »); for a vigilance certificate, six months from its issue, the day
 * before.
 */
export function documentValidUntil(
  document: Pick<ContractorDocument, 'kind' | 'issuedOn' | 'validUntil'>,
): string {
  if (document.validUntil !== null) return document.validUntil;
  if (document.kind === 'tax_residence') return `${document.issuedOn.slice(0, 4)}-12-31`;
  return addDays(addMonths(document.issuedOn, VIGILANCE_MONTHS), -1);
}

export type DocumentState = 'valid' | 'expiring' | 'expired';

/**
 * The first day a document is reminded to its member and the owner (EQ-06 lot 5c-2): for a tax residence certificate,
 * the 1st of December of its year, whatever the owner's delay (« ok année civile », Charles, 01/11: it can only be
 * renewed in January, the reminder says so a month ahead); for another, `reminderDays` before its last day.
 */
export function documentReminderFrom(
  document: Pick<ContractorDocument, 'kind' | 'issuedOn' | 'validUntil'>,
  reminderDays: number,
): string {
  const until = documentValidUntil(document);
  if (document.kind === 'tax_residence' && document.validUntil === null) return `${until.slice(0, 4)}-12-01`;
  return addDays(until, -reminderDays);
}

/**
 * A document on `today`: expired the day after its last day, expiring from its reminder (`documentReminderFrom`),
 * valid before.
 */
export function documentState(
  document: Pick<ContractorDocument, 'kind' | 'issuedOn' | 'validUntil'>,
  today: string,
  reminderDays: number,
): DocumentState {
  if (today > documentValidUntil(document)) return 'expired';
  return today >= documentReminderFrom(document, reminderDays) ? 'expiring' : 'valid';
}

/**
 * The newest document of a kind the owner has not refused: a renewal never erases the one an earlier invoice relied
 * on, and a refused file counts as none.
 */
export function newestOf<T extends ContractorDocument>(
  documents: readonly T[],
  kind: ContractorDocumentKind,
): T | null {
  let found: T | null = null;
  for (const one of documents) {
    if (one.review?.decision === 'refused') continue;
    if (one.kind === kind && (found === null || one.issuedOn > found.issuedOn)) found = one;
  }
  return found;
}

/**
 * The documents a reminder follows (EQ-06 lot 5c-2, lot 8): for each kind the regime in force asks for, the newest the
 * owner has not refused; a newer one filed (even waiting for his check) takes the place of the older. A kind with nothing
 * filed has none.
 */
export function documentsFollowed<T extends ContractorDocument>(
  regime: Pick<BillingRegime, 'documents'> | null,
  documents: readonly T[],
): T[] {
  const followed: T[] = [];
  for (const kind of new Set(regime?.documents ?? [])) {
    const newest = newestOf(documents, kind);
    if (newest !== null) followed.push(newest);
  }
  return followed;
}

/**
 * The documents to remind on `today` (EQ-06 lot 5c-2): those a reminder follows (`documentsFollowed`), once expiring or
 * expired. A kind with nothing filed is not reminded here: a transfer that needs it says so (`payout_blocked_conflict`,
 * ADR 0041) or an invoice warns (`document_missing`).
 */
export function documentsToRemind<T extends ContractorDocument>(
  regime: Pick<BillingRegime, 'documents'> | null,
  documents: readonly T[],
  today: string,
  reminderDays: number,
): T[] {
  return documentsFollowed(regime, documents).filter(
    (document) => documentState(document, today, reminderDays) !== 'valid',
  );
}

/**
 * Where a contractor stands for a calendar year under a regime that sets the 182 B withholding aside by a tax treaty:
 * `covered` by a tax residence certificate of that year the owner accepted (the newest of them, `document`);
 * `unverified` when one is filed for that year and waits for his check; `missing` otherwise, a refused or out-of-year
 * one counting as none. Since ADR 0041 the year is that of a transfer, and only `covered` lets it be recorded: without
 * the proof before the payment, the treaty does not apply and the agency would owe 25 %, which it never withholds.
 */
export function taxResidenceOf<T extends ContractorDocument>(
  documents: readonly T[],
  year: string,
): { readonly state: 'covered'; readonly document: T } | { readonly state: 'unverified' | 'missing' } {
  const filed = documents.filter(
    (one) =>
      one.kind === 'tax_residence' &&
      one.review?.decision !== 'refused' &&
      documentValidUntil(one).slice(0, 4) === year,
  );
  let accepted: T | null = null;
  for (const one of filed) {
    if (one.review?.decision === 'accepted' && (accepted === null || one.issuedOn > accepted.issuedOn))
      accepted = one;
  }
  if (accepted !== null) return { state: 'covered', document: accepted };
  return { state: filed.length > 0 ? 'unverified' : 'missing' };
}

/** Whether a transfer under the regime waits for a tax residence certificate of its year (`taxResidenceOf`, ADR 0041). */
export const treatyNeedsResidence = (regime: Pick<BillingRegime, 'withholding'>): boolean =>
  regime.withholding === 'treaty_exempt';

/** The identity an invoice prints for the contractor: its mentions, required. */
export interface ContractorIdentity {
  readonly legalName: string;
  readonly address: string;
  readonly country: string;
  readonly taxId: string | null;
  /** The SIREN or SIRET, which a contractor established in France must have (EQ-06 lot 4). */
  readonly businessId: string | null;
  /** The VAT number, which a contractor who charges VAT must have. */
  readonly vatNumber: string | null;
  /** An individual entrepreneur: their invoices print « EI » after their name. */
  readonly individualEntrepreneur: boolean;
  /** A company established in France: its legal form, share capital and trade-register town (art. R123-237 C. com.). */
  readonly legalForm: string | null;
  readonly shareCapitalMinor: number | null;
  readonly rcsCity: string | null;
}

const filled = (text: string | null | undefined): boolean =>
  text !== null && text !== undefined && text.trim() !== '';

/** A French company's three mentions, all filled: its legal form, a share capital, the town of its trade register. */
const companyComplete = (identity: ContractorIdentity): boolean =>
  filled(identity.legalForm) && identity.shareCapitalMinor !== null && filled(identity.rcsCity);

/**
 * Whether the contractor's file holds everything their invoice must print under `regime`, never an invoice without
 * it: their name, address and country; the tax id the regime asks for (the IFU of Benin, the NIF of Madagascar); their
 * SIREN or SIRET when they are established in France, whatever their regime; established in France and not an
 * individual entrepreneur, a company's legal form, share capital and trade-register town (art. R123-237 of the Code de
 * commerce); their VAT number when the regime charges VAT (art. 242 nonies A of annex II to the CGI). Rules of the
 * code, never of a regime's text.
 */
export function identityComplete(
  identity: ContractorIdentity | null,
  regime: Pick<BillingRegime, 'taxIdRequired' | 'vat'>,
): identity is ContractorIdentity {
  return (
    identity !== null &&
    filled(identity.legalName) &&
    filled(identity.address) &&
    filled(identity.country) &&
    (!regime.taxIdRequired || filled(identity.taxId)) &&
    (identity.country !== 'FR' || filled(identity.businessId)) &&
    (identity.country !== 'FR' || identity.individualEntrepreneur || companyComplete(identity)) &&
    (regime.vat.treatment !== 'charged' || filled(identity.vatNumber))
  );
}
