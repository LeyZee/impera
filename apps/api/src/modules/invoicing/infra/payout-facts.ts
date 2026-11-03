import { WithholdingSchema } from '@impera/contracts';
import type { Transaction } from '@impera/db';

import { contractorReadsForInvoicing as fileReads } from '../../contractors';
import type { PayoutDocument, PayoutFacts } from '../domain/payouts';

import { settlementFactsOf } from './settlement-rows';

/**
 * What decides the transfers of each contractor of `memberIds` (ADR 0041, `payoutDecision`), one read per table
 * whoever reads them: his regimes, the reconciliation's facts and his tax residence certificates with the owner's check,
 * the file's read through `contractorReadsForInvoicing`.
 * Pay reads one contractor; the period's read, each contractor it shows.
 */
export async function payoutFactsOf(
  tx: Transaction,
  memberIds: readonly string[],
): Promise<Map<string, PayoutFacts<PayoutDocument>>> {
  const settlement = await settlementFactsOf(tx, memberIds);
  if (memberIds.length === 0) return new Map();
  const regimes = await fileReads.withholdings(tx);
  const assignments = await fileReads.assignmentsOf(tx, memberIds);
  const certificates = await fileReads.certificatesOf(tx, memberIds);
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
              review: one.review,
            })),
        },
      ];
    }),
  );
}
