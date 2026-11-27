import { StaircaseSettingSchema, type FanTiersSetting, type StaircaseSetting } from '@impera/contracts';

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

/** The cap at a script's start as typed: a multiple, with a comma or a point; empty, the cap is off. */
export const startCapTextOf = (setting: StaircaseSetting): string =>
  setting.startCapMultiple === undefined ? '' : String(setting.startCapMultiple).replace('.', ',');

/** The setting typed, or why it cannot be saved, in his words. */
export function startCapOf(
  text: string,
): { readonly setting: StaircaseSetting } | { readonly problem: string } {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return { setting: {} };
  const parsed = StaircaseSettingSchema.safeParse({
    startCapMultiple: /^\d+(\.\d+)?$/u.test(trimmed) ? Number(trimmed) : Number.NaN,
  });
  if (!parsed.success)
    return { problem: 'Un multiple au-dessus de 1, jusqu’à 10, ou rien pour couper le plafond.' };
  return { setting: parsed.data };
}
