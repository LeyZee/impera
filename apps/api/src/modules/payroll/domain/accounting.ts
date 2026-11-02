/**
 * The yearly sums a DAS2 declares (EQ-06 lot 7c), the pure rule. The journal of the contractors' invoices and transfers
 * is `journal.ts`.
 */

/**
 * A DAS2 declares fees of more than 2 400 € paid to one beneficiary in the calendar year, what was paid with any VAT,
 * non-residents included (art. 240 of the CGI; doubled for sums paid from 2024, BOI-BIC-DECLA-30-70-20 § 140).
 */
const DAS2_THRESHOLD_MINOR = 240_000;

export interface PaymentForDas2 {
  readonly contractorId: string;
  readonly paidOn: string;
  readonly sentMinor: number;
}

/** The beneficiaries of the year's DAS2: what each was paid in the calendar year, over the threshold only. */
export function das2Beneficiaries(
  year: number,
  payments: readonly PaymentForDas2[],
): { readonly contractorId: string; readonly paidMinor: number }[] {
  const totals = new Map<string, number>();
  for (const payment of payments) {
    if (payment.paidOn.slice(0, 4) !== String(year)) continue;
    totals.set(payment.contractorId, (totals.get(payment.contractorId) ?? 0) + payment.sentMinor);
  }
  return [...totals]
    .filter(([, paidMinor]) => paidMinor > DAS2_THRESHOLD_MINOR)
    .map(([contractorId, paidMinor]) => ({ contractorId, paidMinor }))
    .toSorted((a, b) => a.contractorId.localeCompare(b.contractorId));
}
