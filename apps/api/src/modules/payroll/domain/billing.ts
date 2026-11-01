import type {
  ContractorDocumentKind,
  InvoiceAgency,
  InvoiceNotIssuedReason,
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
  /** The contractor's tax identifier is a mention of the regime (a SIREN or SIRET in France). */
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

/** A document of the contractor's file, as filed. */
export interface ContractorDocument {
  readonly kind: ContractorDocumentKind;
  readonly issuedOn: string;
  /** The end the document states, when it states one; else its kind decides. */
  readonly validUntil: string | null;
}

/** How long a document holds from its issue, when it states no end: a year for residence, six months for vigilance. */
const VALIDITY_MONTHS: Readonly<Record<ContractorDocumentKind, number>> = {
  tax_residence: 12,
  urssaf_vigilance: 6,
};

/** `day` plus `months`, on the same date or the month's last one (31 August plus six months is 28 or 29 February). */
function addMonths(day: string, months: number): string {
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

/** The last day a document holds: the end it states, else its issue plus its kind's months, the day before. */
export function documentValidUntil(document: ContractorDocument): string {
  return document.validUntil ?? addDays(addMonths(document.issuedOn, VALIDITY_MONTHS[document.kind]), -1);
}

export type DocumentState = 'valid' | 'expiring' | 'expired';

/**
 * A document on `today`: expired the day after its last day, expiring from `reminderDays` before it (the reminder to
 * the member and the owner), valid before.
 */
export function documentState(
  document: ContractorDocument,
  today: string,
  reminderDays: number,
): DocumentState {
  const until = documentValidUntil(document);
  if (today > until) return 'expired';
  return today >= addDays(until, -reminderDays) ? 'expiring' : 'valid';
}

/** The newest document of a kind: a renewal never erases the one an earlier invoice relied on. */
function newestOf(
  documents: readonly ContractorDocument[],
  kind: ContractorDocumentKind,
): ContractorDocument | null {
  let found: ContractorDocument | null = null;
  for (const one of documents) {
    if (one.kind === kind && (found === null || one.issuedOn > found.issuedOn)) found = one;
  }
  return found;
}

/** The identity an invoice prints for the contractor: its mentions, required. */
export interface ContractorIdentity {
  readonly legalName: string;
  readonly address: string;
  readonly country: string;
  readonly taxId: string | null;
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
  readonly mandate: MandateFacts;
  readonly assignments: readonly RegimeAssignment[];
  readonly regimes: readonly BillingRegime[];
  readonly identity: ContractorIdentity | null;
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

/** Whether `identity` prints every mention of the contractor `regime` asks for: never an invoice without one. */
export function identityComplete(
  identity: ContractorIdentity | null,
  regime: Pick<BillingRegime, 'taxIdRequired'>,
): identity is ContractorIdentity {
  return (
    identity !== null &&
    filled(identity.legalName) &&
    filled(identity.address) &&
    filled(identity.country) &&
    (!regime.taxIdRequired || filled(identity.taxId))
  );
}

/**
 * Whether the validation of a statement issues its invoice. A period that brings nothing to invoice issues none, and
 * nothing is said to the owner. Otherwise no accepted mandate, no regime, a regime the accountant has not validated,
 * an identity that lacks a mention the regime prints, no prefix or no identity of the agency: no invoice, since an
 * issued invoice never changes. Documents missing or out of date, or a mandate of an older version: the invoice goes
 * out, with a warning.
 */
export function issueDecision(facts: IssueFacts): IssueDecision {
  const assignment = regimeOn(facts.assignments, facts.day);
  const regime =
    assignment === null ? null : (facts.regimes.find((one) => one.id === assignment.regimeId) ?? null);
  const warnings: IssueWarning[] = [];
  for (const kind of regime?.documents ?? []) {
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
  if (!identityComplete(facts.identity, regime)) return none('identity_incomplete');
  if (facts.prefix === null) return none('prefix_missing');
  if (facts.agency === null) return none('agency_missing');
  return { kind: 'issue', regime, warnings };
}
