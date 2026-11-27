import {
  ContractorDocumentKindSchema,
  InvoiceAgencySchema,
  InvoiceRegimeSchema,
  type InvoiceNotIssuedReason,
} from '@impera/contracts';
import type { Transaction } from '@impera/db';

import { contractorReadsForInvoicing as fileReads } from '../../contractors';
import { regimeOn, taxResidenceOf, treatyNeedsResidence } from '../../contractors/pure';
import { issueGaps, type IssueFacts } from '../domain/billing';

/** A gap before the first invoice or transfer: every reason the validation or the transfer would give, but a credit note's. */
export type BillingGap = Exclude<InvoiceNotIssuedReason, 'no_invoice_to_credit'>;

/**
 * What stops an invoice of `memberId` from going out on `day` if his fortnight brought something to invoice, and its
 * transfer from being recorded (« Mise en route », pilotage plan W1), every gap at once (recette PARC-01): empty when
 * both could; otherwise, first, the very reason the validation (`issueDecision`) would give, then what it would refuse
 * in turn (`issueGaps`), then, under a tax treaty, the residence certificate the transfer (`payoutDecision`) waits for.
 * Read as things stand now, never as a past run said it (recette PARC-05), in the caller's transaction (an admin one);
 * the file alone reads its tables, through `contractorReadsForInvoicing`.
 */
export async function invoiceGaps(tx: Transaction, memberId: string, day: string): Promise<BillingGap[]> {
  const mandate = await fileReads.mandateOf(tx, memberId);
  const profile = await fileReads.profileOf(tx, memberId);
  const settings = await fileReads.settings(tx);
  const documents = (await fileReads.documentsOf(tx, memberId)).map((one) => ({
    kind: ContractorDocumentKindSchema.parse(one.kind),
    issuedOn: one.issuedOn,
    validUntil: one.validUntil,
    review: one.review,
  }));
  const facts: IssueFacts = {
    day,
    mandate: {
      acceptedVersion: mandate.accepted?.version ?? null,
      currentVersion: mandate.currentVersion ?? 0,
    },
    assignments: (await fileReads.assignmentsOf(tx, [memberId])).map((one) => ({
      regimeId: one.regimeId,
      from: one.from,
    })),
    regimes: (await fileReads.regimes(tx)).map((regime) => InvoiceRegimeSchema.parse(regime)),
    regimesOfCountry: new Set(await fileReads.regimesOfCountry(tx, memberId)),
    identity:
      profile === undefined
        ? null
        : {
            legalName: profile.profile.legalName,
            address: profile.profile.address,
            country: profile.country,
            taxId: profile.profile.taxId,
            businessId: profile.profile.businessId,
            vatNumber: profile.profile.vatNumber,
            individualEntrepreneur: profile.profile.individualEntrepreneur,
            legalForm: profile.profile.legalForm,
            shareCapitalMinor: profile.profile.shareCapitalMinor,
            rcsCity: profile.profile.rcsCity,
          },
    identityVerified: profile !== undefined && profile.profile.verifiedAt !== null,
    prefix: profile?.profile.invoicePrefix ?? null,
    // Without the designation of the service, the settings are not filled: nothing is issued (`agency_missing`).
    // An identity that no longer reads (a field added since) is one to fill again: never a 500 on the checklist.
    agency:
      settings === undefined || settings.serviceDescription === null
        ? null
        : (InvoiceAgencySchema.safeParse(settings.agency).data ?? null),
    documents,
    // Something to invoice: the question is what stands in its way, not whether the fortnight brought anything.
    exclVatMinor: 1,
  };
  const gaps: BillingGap[] = issueGaps(facts);
  // Under a tax treaty the invoice goes out, but the transfer waits for a residence certificate of its year (ADR 0041,
  // `payoutDecision`): a chatter abroad would be paid late. Said with the same reasons the transfer would give, after
  // what the invoice waits for.
  const assignment = regimeOn(facts.assignments, day);
  const regime =
    assignment === null ? undefined : facts.regimes.find((one) => one.id === assignment.regimeId);
  if (regime !== undefined && treatyNeedsResidence(regime)) {
    const residence = taxResidenceOf(documents, day.slice(0, 4));
    if (residence.state !== 'covered') {
      gaps.push(residence.state === 'missing' ? 'tax_residence_missing' : 'tax_residence_unverified');
    }
  }
  return gaps;
}
