import {
  ContractorDocumentKindSchema,
  InvoiceAgencySchema,
  InvoiceRegimeSchema,
  type InvoiceNotIssuedReason,
} from '@impera/contracts';
import type { Transaction } from '@impera/db';

import { contractorReadsForInvoicing as fileReads } from '../../contractors';
import { taxResidenceOf, treatyNeedsResidence } from '../../contractors/pure';
import { issueDecision } from '../domain/billing';

/**
 * Whether an invoice of `memberId` could go out on `day` if his fortnight brought something to invoice, and its
 * transfer be recorded (« Mise en route », pilotage plan W1): `null` when both could, otherwise what stops them, the
 * very reason the validation (`issueDecision`) or the transfer (`payoutDecision`) would give. Read in the caller's
 * transaction (an admin one); the file alone reads its tables, through `contractorReadsForInvoicing`.
 */
export async function invoiceReadiness(
  tx: Transaction,
  memberId: string,
  day: string,
): Promise<Exclude<InvoiceNotIssuedReason, 'no_invoice_to_credit'> | null> {
  const mandate = await fileReads.mandateOf(tx, memberId);
  const profile = await fileReads.profileOf(tx, memberId);
  const settings = await fileReads.settings(tx);
  const documents = (await fileReads.documentsOf(tx, memberId)).map((one) => ({
    kind: ContractorDocumentKindSchema.parse(one.kind),
    issuedOn: one.issuedOn,
    validUntil: one.validUntil,
    review: one.review,
  }));
  const decision = issueDecision({
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
  });
  if (decision.kind === 'issue') {
    // Under a tax treaty the invoice goes out, but the transfer waits for a residence certificate of its year (ADR 0041,
    // `payoutDecision`): a chatter abroad would be paid late. Said with the same reasons the transfer would give.
    if (!treatyNeedsResidence(decision.regime)) return null;
    const residence = taxResidenceOf(documents, day.slice(0, 4));
    if (residence.state === 'covered') return null;
    return residence.state === 'missing' ? 'tax_residence_missing' : 'tax_residence_unverified';
  }
  return decision.reason === 'nothing_to_invoice' ? null : decision.reason;
}
