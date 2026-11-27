import type { FanTiersSetting } from '@impera/contracts';

import { eurosOfMinor, minorOfEuros } from '../custom-prices/model';

export type TierKey = keyof FanTiersSetting;

/** The three thresholds, rising, with the words the chatter reads (Charles, 21/11). */
export const TIER_FIELDS: readonly (readonly [TierKey, string])[] = [
  ['goodFromMinor', 'Bon payeur à partir de'],
  ['veryGoodFromMinor', 'Très bon payeur à partir de'],
  ['whaleFromMinor', 'Baleine à partir de'],
];

export type TierTexts = Readonly<Record<TierKey, string>>;

export const textsOf = (tiers: FanTiersSetting): TierTexts => ({
  goodFromMinor: eurosOfMinor(tiers.goodFromMinor),
  veryGoodFromMinor: eurosOfMinor(tiers.veryGoodFromMinor),
  whaleFromMinor: eurosOfMinor(tiers.whaleFromMinor),
});

/** The thresholds typed, or why they cannot be saved, in his words. */
export function tiersOf(
  texts: TierTexts,
): { readonly tiers: FanTiersSetting } | { readonly problem: string } {
  const good = minorOfEuros(texts.goodFromMinor);
  const veryGood = minorOfEuros(texts.veryGoodFromMinor);
  const whale = minorOfEuros(texts.whaleFromMinor);
  if (typeof good !== 'number' || typeof veryGood !== 'number' || typeof whale !== 'number' || good === 0)
    return { problem: 'Un montant en euros par palier, plus que zéro.' };
  if (!(good < veryGood && veryGood < whale))
    return { problem: 'Chaque palier commence plus haut que le précédent.' };
  return { tiers: { goodFromMinor: good, veryGoodFromMinor: veryGood, whaleFromMinor: whale } };
}
