import type { PayoutBlockReason } from '@nirvana/contracts';

import {
  regimeOn,
  taxResidenceOf,
  treatyNeedsResidence,
  type BillingRegime,
  type ContractorDocument,
  type RegimeAssignment,
} from './billing';
import {
  settledByTransfer,
  type SettlementCarryOver,
  type SettlementDocument,
  type SettlementStatement,
} from './settlements';

/**
 * Whether a transfer may be recorded (ADR 0041). Under a regime whose tax treaty sets the 182 B withholding aside, the
 * agency pays only with the proof in hand before the payment: a tax residence certificate of the transfer's calendar
 * year the owner accepted. Without it, the agency never withholds 25 %: it does not pay. The invoice itself goes out
 * without the certificate (§ 1); only the transfer waits (§ 2).
 */

/** A contractor's document as pay reads it here, with its id: the certificate a transfer relies on is recorded. */
export interface PayoutDocument extends ContractorDocument {
  readonly id: string;
}

/** An issued document, and whether it was issued under a regime whose tax treaty sets the withholding aside. */
export interface PayoutSettlementDocument extends SettlementDocument {
  readonly underTreaty: boolean;
}

/** What one contractor's transfers are decided on. */
export interface PayoutFacts<T extends PayoutDocument> {
  readonly assignments: readonly RegimeAssignment[];
  readonly regimes: readonly Pick<BillingRegime, 'id' | 'withholding'>[];
  readonly statements: readonly SettlementStatement[];
  readonly carryOvers: readonly SettlementCarryOver[];
  readonly documents: readonly PayoutSettlementDocument[];
  readonly certificates: readonly T[];
}

export type PayoutDecision<T extends PayoutDocument> =
  /** No treaty is involved: the transfer needs no certificate. */
  | { readonly kind: 'free' }
  /** The certificate of the transfer's year the owner accepted: the newest, which the record keeps. */
  | { readonly kind: 'covered'; readonly certificate: T }
  | { readonly kind: 'blocked'; readonly reason: PayoutBlockReason; readonly year: string };

/**
 * Whether the transfer for `statementId` dated `paidOn` may be recorded. The certificate is needed when the regime in
 * force on `paidOn` has such a treaty, or when the transfer pays an invoice issued under one: that of the statement or
 * of a statement carried into it (`settledByTransfer`, ADR 0038). Only a certificate of `paidOn`'s calendar year
 * counts, without the BOFiP's tolerance to 31 March: another year's, a refused one or one still to check does not.
 */
export function payoutDecision<T extends PayoutDocument>(
  facts: PayoutFacts<T>,
  statementId: string,
  paidOn: string,
): PayoutDecision<T> {
  const assignment = regimeOn(facts.assignments, paidOn);
  const regime =
    assignment === null ? null : (facts.regimes.find((one) => one.id === assignment.regimeId) ?? null);
  const underTreaty = new Set(facts.documents.filter((one) => one.underTreaty).map((one) => one.id));
  const paysTreatyInvoice = settledByTransfer(
    statementId,
    facts.statements,
    facts.carryOvers,
    facts.documents,
  ).some((one) => one.kind === 'paid' && underTreaty.has(one.documentId));
  if (!(regime !== null && treatyNeedsResidence(regime)) && !paysTreatyInvoice) return { kind: 'free' };
  const year = paidOn.slice(0, 4);
  const residence = taxResidenceOf(facts.certificates, year);
  if (residence.state === 'covered') return { kind: 'covered', certificate: residence.document };
  return {
    kind: 'blocked',
    reason: residence.state === 'missing' ? 'tax_residence_missing' : 'tax_residence_unverified',
    year,
  };
}
