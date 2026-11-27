import type { SalesTotalsRow } from '@impera/contracts';

/** How far back the VAT the platform reads is taken (recette PARC-10): thirty days, like the agency's share. */
export const OBSERVED_VAT_DAYS = 30;

/**
 * The VAT the platform reads on an account's sales (recette PARC-10), in basis points: what it takes off the price the
 * fans paid, over what is left, summed on the rows given. `null` with nothing sold, or a currency other than the
 * rows' first, never mixed. A signal for the owner only: pay never reads it, the rules stay his.
 */
export function observedVatBps(rows: readonly SalesTotalsRow[], platformAccountId: string): number | null {
  const own = rows.filter((row) => row.platformAccountId === platformAccountId);
  const currency = own[0]?.currency;
  let incl = 0;
  let excl = 0;
  for (const row of own) {
    if (row.currency !== currency) continue;
    incl += row.grossInclVatMinor;
    excl += row.grossExclVatMinor;
  }
  if (excl <= 0 || incl < excl) return null;
  return Math.round(((incl - excl) * 10_000) / excl);
}
