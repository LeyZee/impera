import { WithholdingSchema } from '@nirvana/contracts';
import { and, eq, inArray, schema, type Transaction } from '@nirvana/db';

import { reviewOf } from '../../contractors';
import type { PayoutDocument, PayoutFacts } from '../domain/payouts';

import { settlementFactsOf } from './settlement-rows';

const { billingRegimes, contractorDocumentReviews, contractorDocuments, contractorRegimes } = schema;

/**
 * What decides the transfers of each contractor of `memberIds` (ADR 0041, `payoutDecision`), one read per table
 * whoever reads them: his regimes, the reconciliation's facts and his tax residence certificates with the owner's check.
 * Pay reads one contractor; the period's read, each contractor it shows.
 */
export async function payoutFactsOf(
  tx: Transaction,
  memberIds: readonly string[],
): Promise<Map<string, PayoutFacts<PayoutDocument>>> {
  const settlement = await settlementFactsOf(tx, memberIds);
  if (memberIds.length === 0) return new Map();
  const regimes = await tx
    .select({ id: billingRegimes.id, withholding: billingRegimes.withholding })
    .from(billingRegimes);
  const assignments = await tx
    .select({
      memberId: contractorRegimes.memberId,
      regimeId: contractorRegimes.regimeId,
      from: contractorRegimes.effectiveFrom,
    })
    .from(contractorRegimes)
    .where(inArray(contractorRegimes.memberId, [...memberIds]));
  const certificates = await tx
    .select({
      memberId: contractorDocuments.memberId,
      id: contractorDocuments.id,
      issuedOn: contractorDocuments.issuedOn,
      validUntil: contractorDocuments.validUntil,
      decision: contractorDocumentReviews.decision,
      reason: contractorDocumentReviews.reason,
    })
    .from(contractorDocuments)
    .leftJoin(contractorDocumentReviews, eq(contractorDocumentReviews.documentId, contractorDocuments.id))
    .where(
      and(
        inArray(contractorDocuments.memberId, [...memberIds]),
        eq(contractorDocuments.kind, 'tax_residence'),
      ),
    );
  const withholdings = regimes.map((one) => ({
    id: one.id,
    withholding: WithholdingSchema.parse(one.withholding),
  }));
  return new Map(
    memberIds.map((memberId): [string, PayoutFacts<PayoutDocument>] => {
      const facts = settlement.get(memberId) ?? { statements: [], carryOvers: [], documents: [] };
      return [
        memberId,
        {
          ...facts,
          regimes: withholdings,
          assignments: assignments
            .filter((one) => one.memberId === memberId)
            .map((one) => ({ regimeId: one.regimeId, from: one.from })),
          certificates: certificates
            .filter((one) => one.memberId === memberId)
            .map((one) => ({
              id: one.id,
              kind: 'tax_residence',
              issuedOn: one.issuedOn,
              validUntil: one.validUntil,
              review: reviewOf(one),
            })),
        },
      ];
    }),
  );
}
