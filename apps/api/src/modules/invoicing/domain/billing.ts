import type { ContractorDocumentKind, InvoiceAgency, InvoiceNotIssuedReason } from '@impera/contracts';

import {
  documentState,
  documentValidUntil,
  identityComplete,
  newestOf,
  regimeOn,
  treatyNeedsResidence,
  type BillingRegime,
  type ContractorDocument,
  type ContractorIdentity,
  type RegimeAssignment,
} from '../../contractors/pure';

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

/**
 * Whether the validation of a statement issues its invoice. A period that brings nothing to invoice issues none, and
 * nothing is said to the owner. Otherwise no identity of the agency or no mandate published yet, no accepted mandate, no regime, a regime the accountant has not validated or
 * not written for the contractor's country as his member record now says it, an identity that lacks a mention the
 * regime prints or that the owner has not checked as it stands, or no prefix: no invoice, since
 * an issued invoice never changes. Other documents missing or out of date, or a mandate of an older version: the
 * invoice goes out, with a warning. Under a tax treaty, the tax residence certificate is neither: it gates the
 * transfer, not the invoice (ADR 0041).
 */
export function issueDecision(facts: IssueFacts): IssueDecision {
  const assignment = regimeOn(facts.assignments, facts.day);
  const regime =
    assignment === null ? null : (facts.regimes.find((one) => one.id === assignment.regimeId) ?? null);
  const warnings: IssueWarning[] = [];
  const residenceGatesTransfer = regime !== null && treatyNeedsResidence(regime);
  for (const kind of regime?.documents ?? []) {
    // Under a treaty, the residence certificate is no warning: the transfer waits for it (ADR 0041, `payoutDecision`).
    if (kind === 'tax_residence' && residenceGatesTransfer) continue;
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
  // What only the agency settles comes first (recette EQP-02): until its identity is filled and its mandate published,
  // no member can do anything, and « he has not accepted his mandate » would send him to a text he cannot accept.
  if (facts.agency === null) return none('agency_missing');
  if (currentVersion === 0) return none('mandate_unpublished');
  if (acceptedVersion === null) return none('no_mandate');
  if (regime === null) return none('no_regime');
  if (regime.validatedOn === null || regime.validatedOn > facts.day) return none('regime_not_validated');
  // His record moved to another country since the regime was given (« ok pays », Charles, 01/11): another country's
  // mentions and VAT would be printed. The owner gives him a regime of his country, from today.
  if (!facts.regimesOfCountry.has(regime.id)) return none('regime_country_mismatch');
  if (!identityComplete(facts.identity, regime)) return none('identity_incomplete');
  if (!facts.identityVerified) return none('identity_unverified');
  if (facts.prefix === null) return none('prefix_missing');
  return { kind: 'issue', regime, warnings };
}
