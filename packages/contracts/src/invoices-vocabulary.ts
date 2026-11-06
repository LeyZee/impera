import { z } from 'zod';

import { BasisPointsSchema } from './team';

/**
 * The invoices' closed lists (EQ-06, ADR 0036): kinds of invoice, line, event, acceptance, VAT, withholding, document
 * and contract text.
 */

/** An invoice, or a credit note that cites one: both numbered in the contractor's one sequence. */
export const INVOICE_KINDS = ['invoice', 'credit_note'] as const;
export const InvoiceKindSchema = z.enum(INVOICE_KINDS);
export type InvoiceKind = z.infer<typeof InvoiceKindSchema>;

/**
 * What a line is: a commission per account, the team share, the bonuses, a penalty as a deduction the contract
 * provides for and the cap that gives part of them back, an adjustment with its period, and on a credit note a
 * reduction or a period's negative balance (ADR 0036).
 */
export const INVOICE_LINE_KINDS = [
  'commission',
  'team_share',
  'tier_bonus',
  'collective_bonus',
  'bonus',
  'penalty',
  'penalty_cap',
  'adjustment',
  'reduction',
  'negative_period',
] as const;
export const InvoiceLineKindSchema = z.enum(INVOICE_LINE_KINDS);
export type InvoiceLineKind = z.infer<typeof InvoiceLineKindSchema>;

/**
 * How VAT goes on an invoice of the regime. `reverse_charge`: the agency self-assesses it (art. 283-2 of the CGI),
 * nothing is invoiced and the rate serves the purchase journal. `exempt`: the contractor is under the franchise
 * (art. 293 B of the CGI). `charged`: the contractor charges VAT at the rate.
 */
export const VAT_TREATMENTS = ['reverse_charge', 'exempt', 'charged'] as const;
export const RegimeVatSchema = z.discriminatedUnion('treatment', [
  z.object({ treatment: z.literal('reverse_charge'), rateBps: BasisPointsSchema }),
  z.object({ treatment: z.literal('exempt') }),
  z.object({ treatment: z.literal('charged'), rateBps: BasisPointsSchema }),
]);
export type RegimeVat = z.infer<typeof RegimeVatSchema>;

/** The 182 B withholding: set aside by the tax treaty with the contractor's country, or not due at all. */
export const WITHHOLDINGS = ['treaty_exempt', 'none'] as const;
export const WithholdingSchema = z.enum(WITHHOLDINGS);
export type Withholding = z.infer<typeof WithholdingSchema>;

/** A document a regime asks of the contractor: the tax residence certificate, or the URSSAF one (vigilance). */
export const CONTRACTOR_DOCUMENT_KINDS = ['tax_residence', 'urssaf_vigilance'] as const;
export const ContractorDocumentKindSchema = z.enum(CONTRACTOR_DOCUMENT_KINDS);
export type ContractorDocumentKind = z.infer<typeof ContractorDocumentKindSchema>;

/** The two texts a contractor accepts before his first invoice: the service contract and the billing mandate. */
export const CONTRACT_TEXT_KINDS = ['service_contract', 'billing_mandate'] as const;
export const ContractTextKindSchema = z.enum(CONTRACT_TEXT_KINDS);
export type ContractTextKind = z.infer<typeof ContractTextKindSchema>;

/** Where an invoice or a credit note stands with its contractor (glossary « Acceptation d'une facture »). */
export const INVOICE_ACCEPTANCE_STATES = [
  'pending',
  'accepted',
  'tacitly_accepted',
  'contested',
  /** The owner upheld the contest, and pay corrects it (ADR 0039 § 3). */
  'contest_upheld',
  'contest_refused',
] as const;
export const InvoiceAcceptanceStateSchema = z.enum(INVOICE_ACCEPTANCE_STATES);
export type InvoiceAcceptanceState = z.infer<typeof InvoiceAcceptanceStateSchema>;

/**
 * A step of an invoice's life, each dated in `invoice_events`, added only. The last three settle a document in full,
 * once, and name the statement that settles it (EQ-06 lot 7a): `paid`, an invoice by that statement's transfer;
 * `imputed`, a credit note deducted from it; `compensated`, a document whose debt ends with no transfer, at a statement
 * whose cumulated total is zero, or below zero for an invoice (ADR 0038, art. 1347 du Code civil).
 */
export const INVOICE_EVENT_KINDS = [
  'issued',
  'accepted',
  'contested',
  'lapsed',
  'contest_upheld',
  'contest_refused',
  'paid',
  'imputed',
  'compensated',
] as const;
export const InvoiceEventKindSchema = z.enum(INVOICE_EVENT_KINDS);
export type InvoiceEventKind = z.infer<typeof InvoiceEventKindSchema>;

/**
 * Why a document a validated statement makes due is not issued (EQ-06): its invoice, for want of an accepted mandate,
 * of a regime the accountant validated and written for the contractor's country, of a full identity the owner checked,
 * of a prefix or of the agency's identity; a credit note the period owes, when no invoice can take it whole (ADR 0036).
 * The statement stays validated and the owner is told (`invoice_not_issued`).
 */
export const INVOICE_NOT_ISSUED_REASONS = [
  /**
   * The agency has published no mandate yet (Réglages › Facturation): no member can accept one, so the owner is told
   * this, never `no_mandate` (recette EQP-02).
   */
  'mandate_unpublished',
  'no_mandate',
  'no_regime',
  'regime_not_validated',
  /**
   * The regime in force is not one of the country the contractor's member record now gives: changed since the regime
   * was given (« ok pays », Charles, 01/11). The owner gives him a regime of his country.
   */
  'regime_country_mismatch',
  'identity_incomplete',
  /** The file is complete, but the owner has not checked it, or a change of identity cleared his check (EQ-06). */
  'identity_unverified',
  /**
   * No tax residence certificate of the period's year under a tax treaty (lot 5c). Since ADR 0041 the certificate gates
   * the transfer (`payout_blocked_conflict`), not the invoice: no issue gives this reason any more, kept to read what
   * was written before.
   */
  'tax_residence_missing',
  /** A certificate of the period's year waiting for the owner's check (lot 5c); kept as `tax_residence_missing` is. */
  'tax_residence_unverified',
  'prefix_missing',
  'agency_missing',
  'no_invoice_to_credit',
] as const;
export const InvoiceNotIssuedReasonSchema = z.enum(INVOICE_NOT_ISSUED_REASONS);
export type InvoiceNotIssuedReason = z.infer<typeof InvoiceNotIssuedReasonSchema>;
