/*
 * The medal a commission tier wears (CHF-01, ADR 0104 note « médailles »). Display only: nothing here reads or
 * changes a threshold, a bonus or a statement.
 */

export type Metal = 'bronze' | 'argent' | 'or';

/** A tier's medal: its metal, and its place in the ladder from the lowest (1), engraved I, II, III then a star. */
export interface TierMedal {
  readonly metal: Metal;
  readonly rank: number;
}

const METAL_BY_NAME: Readonly<Record<string, Metal>> = { bronze: 'bronze', argent: 'argent', or: 'or' };

const plain = (label: string): string =>
  label
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();

/** From the top: the highest tier is gold, the one under it silver, every other bronze. */
const METAL_FROM_TOP: readonly Metal[] = ['or', 'argent', 'bronze'];

/**
 * The medals of a ladder of tiers, in the order of their thresholds. A ladder named Bronze, Argent, Or wears the
 * metals of its names; any other is read from the top (Charles, 13/11/2026).
 */
export function tierMedals(tiers: readonly { readonly thresholdMinor: number; readonly label: string }[]): {
  readonly of: (thresholdMinor: number) => TierMedal | null;
} {
  const ordered = tiers.toSorted((a, b) => a.thresholdMinor - b.thresholdMinor);
  const named = ordered.map((tier) => METAL_BY_NAME[plain(tier.label)]);
  const byName = named.every((metal) => metal !== undefined);
  const medals = new Map<number, TierMedal>(
    ordered.map((tier, index) => [
      tier.thresholdMinor,
      {
        metal: (byName ? named[index] : METAL_FROM_TOP[ordered.length - 1 - index]) ?? 'bronze',
        rank: index + 1,
      },
    ]),
  );
  return { of: (thresholdMinor) => medals.get(thresholdMinor) ?? null };
}

const MEDAL_NAMES: Readonly<Record<Metal, string>> = {
  bronze: 'Médaille de bronze',
  argent: 'Médaille d’argent',
  or: 'Médaille d’or',
};

/** What a medal says to a screen reader: the object, never only its colour. */
export const medalLabel = (medal: TierMedal, earned: boolean): string =>
  `${MEDAL_NAMES[medal.metal]}${earned ? '' : ', pas encore gagnée'}`;
