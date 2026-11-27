import { DESIRE_BAND_FLOORS, type FanTier, type StepPriceReason } from '@impera/contracts';

/**
 * The staircase of a script's paid steps (ADR 0098, avenant du 27/11/2026; Charles, « Prix fixe, escalier gardé »).
 * Prices stay the script's, as the catalogue gives them: code never makes one. It only decides whether the next paid
 * step may go, and which of its paid branches when it has several (ADR 0112, branches of a tier, ADR 0132 § 12 bis):
 * - each paid step he is offered costs strictly more than the last paid step he bought in this run, never the same;
 * - at the start of a script (no paid step bought in it yet), its first paid step costs at most one and a half times
 *   his biggest single purchase before; without any purchase, no cap from history;
 * - between several branches that fit, the one closest to twice the last paid step he bought, three times for a whale
 *   who is very hot: the multipliers only rank branches, they never make a price;
 * - nothing fits: his limit is reached, no paid step tonight, and she ends the sexting warmly in words.
 * Pure: amounts are the catalogue's integers, compared as they are (no rounding to do).
 */

/** The branch aimed for: twice the last paid step he bought. */
export const STAIRCASE_TARGET = 2;
/** The branch aimed for with a whale who is very hot: three times. */
export const STAIRCASE_TARGET_WHALE_VERY_HOT = 3;
/** At a script's start, its first paid step costs at most this many times his biggest single purchase before it. */
export const START_CAP_OF_BIGGEST_PURCHASE = 1.5;
/**
 * « Very hot »: his desire score at or above this. The score's own scale has one band above the floor a script needs
 * (`DESIRE_BAND_FLOORS.hot`, 70); very hot is the top of that band, halfway from it to the scale's top (100).
 */
export const VERY_HOT_DESIRE = DESIRE_BAND_FLOORS.hot + (100 - DESIRE_BAND_FLOORS.hot) / 2;
/** The tier of « Fans » (`fanTierOf`, the owner's thresholds) that makes him a whale. */
const WHALE_TIER: FanTier = 'whale';

export interface StepPriceInput {
  /**
   * The prices of the step's paid branches, in cents, in the agency's order (the default first). One for a step
   * without branches.
   */
  readonly branchesMinor: readonly number[];
  /** The last paid step he bought in this run, in cents; `null` before his first purchase of it: the start. */
  readonly lastBoughtMinor: number | null;
  /** His biggest single purchase before this run, in cents; `null` or 0 when he never bought: no cap. */
  readonly biggestPurchaseMinor: number | null;
  readonly fanTier: FanTier | null | undefined;
  /** His desire score now (P3-12). */
  readonly desire: number;
}

export type StepPriceChoice =
  | {
      readonly kind: 'offer';
      /** The branch taken, its index in `branchesMinor`. */
      readonly branch: number;
      readonly priceMinor: number;
      readonly reason: Exclude<StepPriceReason, 'limit_reached'>;
      readonly capMinor: number | null;
    }
  | {
      readonly kind: 'stop';
      readonly reason: Extract<StepPriceReason, 'capped_by_biggest_purchase' | 'limit_reached'>;
      readonly capMinor: number | null;
    };

/** The start's cap, in cents: one and a half times his biggest purchase before, only before his first one of the run. */
function startCapOf(input: Pick<StepPriceInput, 'lastBoughtMinor' | 'biggestPurchaseMinor'>): number | null {
  if (input.lastBoughtMinor !== null) return null;
  const biggest = input.biggestPurchaseMinor;
  return biggest === null || biggest <= 0 ? null : Math.floor(biggest * START_CAP_OF_BIGGEST_PURCHASE);
}

/** The branch aimed for: three times for a whale who is very hot, twice for everyone else. */
const targetMultiplierOf = (fanTier: FanTier | null | undefined, desire: number): number =>
  fanTier === WHALE_TIER && desire >= VERY_HOT_DESIRE ? STAIRCASE_TARGET_WHALE_VERY_HOT : STAIRCASE_TARGET;

/** The price of the next paid step, or why none goes. */
export function stepPriceChoice(input: StepPriceInput): StepPriceChoice {
  const capMinor = startCapOf(input);
  const above = input.branchesMinor
    .map((priceMinor, branch) => ({ priceMinor, branch }))
    .filter(
      ({ priceMinor }) =>
        priceMinor > 0 && (input.lastBoughtMinor === null || priceMinor > input.lastBoughtMinor),
    );
  const fitting = above.filter(({ priceMinor }) => capMinor === null || priceMinor <= capMinor);
  const [first] = fitting;
  if (first === undefined)
    return {
      kind: 'stop',
      reason: above.length > 0 ? 'capped_by_biggest_purchase' : 'limit_reached',
      capMinor,
    };
  const capped = fitting.length < above.length;
  const offer = (
    chosen: { readonly priceMinor: number; readonly branch: number },
    reason: Exclude<StepPriceReason, 'limit_reached'>,
  ): StepPriceChoice => ({ kind: 'offer', ...chosen, reason, capMinor });
  if (fitting.length === 1) return offer(first, capped ? 'capped_by_biggest_purchase' : 'next_step');
  // The start (nothing bought in the run): the agency's order, the default first; the cap may push it to a cheaper one.
  if (input.lastBoughtMinor === null) {
    if (!capped) return offer(first, 'next_step');
    const highest = fitting.reduce((best, one) => (one.priceMinor > best.priceMinor ? one : best), first);
    return offer(highest, 'capped_by_biggest_purchase');
  }
  const multiplier = targetMultiplierOf(input.fanTier, input.desire);
  const target = input.lastBoughtMinor * multiplier;
  // The closest to the target; between two as close, the cheaper.
  const closest = fitting.reduce((best, one) => {
    const gap = Math.abs(one.priceMinor - target);
    const bestGap = Math.abs(best.priceMinor - target);
    return gap < bestGap || (gap === bestGap && one.priceMinor < best.priceMinor) ? one : best;
  }, first);
  return offer(
    closest,
    multiplier === STAIRCASE_TARGET_WHALE_VERY_HOT ? 'branch_triple_whale' : 'branch_double',
  );
}
