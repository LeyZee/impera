import type {
  ContractorDocumentKind,
  ContractorDocumentReview,
  InvoiceAgency,
  InvoiceNotIssuedReason,
  PayPeriod,
  RegimeVat,
} from '@nirvana/contracts';

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
 * A document on `today`: expired the day after its last day, expiring from `reminderDays` before it (the reminder to
 * the member and the owner), valid before.
 */
export function documentState(
  document: Pick<ContractorDocument, 'kind' | 'issuedOn' | 'validUntil'>,
  today: string,
  reminderDays: number,
): DocumentState {
  const until = documentValidUntil(document);
  if (today > until) return 'expired';
  return today >= addDays(until, -reminderDays) ? 'expiring' : 'valid';
}

/**
 * The newest document of a kind the owner has not refused: a renewal never erases the one an earlier invoice relied
 * on, and a refused file counts as none.
 */
function newestOf(
  documents: readonly ContractorDocument[],
  kind: ContractorDocumentKind,
): ContractorDocument | null {
  let found: ContractorDocument | null = null;
  for (const one of documents) {
    if (one.review?.decision === 'refused') continue;
    if (one.kind === kind && (found === null || one.issuedOn > found.issuedOn)) found = one;
  }
  return found;
}

/**
 * Where a contractor stands for a period under a regime that sets the 182 B withholding aside by a tax treaty
 * (Charles's choice (a), 01/11): `covered` by a tax residence certificate of the period's calendar year the owner
 * accepted; `unverified` when one is filed for that year and waits for his check; `missing` otherwise, a refused or
 * out-of-year one counting as none. Only `covered` lets an invoice go out: without the proof, the treaty does not
 * apply and the agency would owe 25 %, which it never withholds.
 */
export function taxResidenceFor(
  documents: readonly ContractorDocument[],
  period: PayPeriod,
): 'covered' | 'unverified' | 'missing' {
  const year = period.slice(0, 4);
  const filed = documents.filter(
    (one) =>
      one.kind === 'tax_residence' &&
      one.review?.decision !== 'refused' &&
      documentValidUntil(one).slice(0, 4) === year,
  );
  if (filed.some((one) => one.review?.decision === 'accepted')) return 'covered';
  return filed.length > 0 ? 'unverified' : 'missing';
}

/** Whether the regime's invoices wait for a tax residence certificate (`taxResidenceFor`). */
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

/** The mandate the contractor accepted, and the agency's version in force. */
interface MandateFacts {
  readonly acceptedVersion: number | null;
  readonly currentVersion: number;
}

/** Said in amber at the validation; the invoice goes out all the same. */
export type IssueWarning =
  | { readonly code: 'document_missing'; readonly kind: ContractorDocumentKind }
  | { readonly code: 'document_expired'; readonly kind: ContractorDocumentKind; readonly until: string }
  | { readonly code: 'mandate_outdated'; readonly accepted: number; readonly current: number };

/**
 * Why a validated statement has no invoice: the statement stays validated, the reason is said to the owner
 * (`invoice_not_issued`), except when the period brings nothing to invoice.
 */
type NoInvoiceReason = Exclude<InvoiceNotIssuedReason, 'no_invoice_to_credit'> | 'nothing_to_invoice';

export type IssueDecision =
  | {
      readonly kind: 'issue';
      readonly regime: BillingRegime;
      readonly warnings: readonly IssueWarning[];
    }
  | {
      readonly kind: 'none';
      readonly reason: NoInvoiceReason;
      readonly warnings: readonly IssueWarning[];
    };

export interface IssueFacts {
  readonly day: string;
  /** The statement's period, the service the invoice bills: the year a tax residence certificate must cover. */
  readonly period: PayPeriod;
  readonly mandate: MandateFacts;
  readonly assignments: readonly RegimeAssignment[];
  readonly regimes: readonly BillingRegime[];
  /** The ids of the regimes written for the country of the contractor's member record, as it reads today. */
  readonly regimesOfCountry: ReadonlySet<string>;
  readonly identity: ContractorIdentity | null;
  /** The owner checked the file as it stands: a change of identity clears his check (the base's trigger). */
  readonly identityVerified: boolean;
  /** The contractor's prefix, which the owner sets: his sequence's. */
  readonly prefix: string | null;
  /** The agency's identity on each invoice, a setting of the owner's. */
  readonly agency: InvoiceAgency | null;
  readonly documents: readonly ContractorDocument[];
  /** What the invoice would total before tax: a statement that brings nothing of its period issues nothing. */
  readonly exclVatMinor: number;
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

/**
 * Whether the validation of a statement issues its invoice. A period that brings nothing to invoice issues none, and
 * nothing is said to the owner. Otherwise no accepted mandate, no regime, a regime the accountant has not validated or
 * not written for the contractor's country as his member record now says it,
 * an identity that lacks a mention the regime prints or that the owner has not checked as it stands, under a tax
 * treaty no tax residence certificate of the period's year accepted by the owner, no prefix or no identity of the
 * agency: no invoice, since an issued invoice never changes. Other documents missing or out of date, or a mandate of
 * an older version: the invoice goes out, with a warning.
 */
export function issueDecision(facts: IssueFacts): IssueDecision {
  const assignment = regimeOn(facts.assignments, facts.day);
  const regime =
    assignment === null ? null : (facts.regimes.find((one) => one.id === assignment.regimeId) ?? null);
  const warnings: IssueWarning[] = [];
  const residenceBlocks = regime !== null && treatyNeedsResidence(regime);
  for (const kind of regime?.documents ?? []) {
    // Under a treaty, the residence certificate is no warning: without it, nothing is issued (`taxResidenceFor`).
    if (kind === 'tax_residence' && residenceBlocks) continue;
    const document = newestOf(facts.documents, kind);
    if (document === null) warnings.push({ code: 'document_missing', kind });
    else if (documentState(document, facts.day, 0) === 'expired') {
      warnings.push({ code: 'document_expired', kind, until: documentValidUntil(document) });
    }
  }
  const { acceptedVersion, currentVersion } = facts.mandate;
  if (acceptedVersion !== null && acceptedVersion < currentVersion) {
    warnings.push({ code: 'mandate_outdated', accepted: acceptedVersion, current: currentVersion });
  }
  const none = (reason: NoInvoiceReason): IssueDecision => ({ kind: 'none', reason, warnings });
  if (facts.exclVatMinor <= 0) return none('nothing_to_invoice');
  if (acceptedVersion === null) return none('no_mandate');
  if (regime === null) return none('no_regime');
  if (regime.validatedOn === null || regime.validatedOn > facts.day) return none('regime_not_validated');
  // His record moved to another country since the regime was given (« ok pays », Charles, 01/11): another country's
  // mentions and VAT would be printed. The owner gives him a regime of his country, from today.
  if (!facts.regimesOfCountry.has(regime.id)) return none('regime_country_mismatch');
  if (!identityComplete(facts.identity, regime)) return none('identity_incomplete');
  if (!facts.identityVerified) return none('identity_unverified');
  if (residenceBlocks) {
    const residence = taxResidenceFor(facts.documents, facts.period);
    if (residence === 'missing') return none('tax_residence_missing');
    if (residence === 'unverified') return none('tax_residence_unverified');
  }
  if (facts.prefix === null) return none('prefix_missing');
  if (facts.agency === null) return none('agency_missing');
  return { kind: 'issue', regime, warnings };
}
