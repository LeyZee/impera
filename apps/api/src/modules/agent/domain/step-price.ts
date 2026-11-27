import type { FanTier, StaircaseSetting, StepPriceReason } from '@impera/contracts';

/**
 * The staircase of a script's paid steps (ADR 0098, avenant du 27/11/2026, « Prix fixe, escalier gardé »). Prices stay
 * the script's, as the catalogue gives them: code never makes one. It only decides whether the next paid step may go,
 * and which of its paid branches when it has several (ADR 0112, branches of a tier, ADR 0132 § 12 bis):
 * - each paid step he is offered costs strictly more than the last paid step he bought in this run, never the same:
 *   this holds whatever the agency set;
 * - at a script's start only (no paid step bought in it yet), its first paid step stays under the agency's cap, a
 *   multiple of his biggest single purchase before; without any purchase, or without the setting, no cap;
 * - between several branches that fit, the one closest to the agency's target, a multiple of the last paid step he
 *   bought (another one for a fan of the top tier hot enough); without the setting, the agency's order;
 * - nothing fits: his limit is reached, no paid step tonight, and she ends the sexting warmly in words.
 * The agency's numbers are its settings (`StaircaseSetting`), never in the repository. Pure: amounts are the
 * catalogue's integers, compared as they are.
 */

/** The tier of « Fans » (`fanTierOf`, the owner's thresholds) whose fans may get the top tier's target. */
const TOP_TIER: FanTier = 'whale';

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
  /** The agency's settings for her; absent or empty, only the strict rise holds. */
  readonly setting: StaircaseSetting | undefined;
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
      readonly reason: Extract<StepPriceReason, 'capped_at_start' | 'limit_reached'>;
      readonly capMinor: number | null;
    };

/** The cap at a script's start, in cents: only before his first purchase of the run, with a purchase and the setting. */
function startCapOf(input: StepPriceInput): number | null {
  const multiple = input.setting?.startCapMultiple;
  const biggest = input.biggestPurchaseMinor;
  if (input.lastBoughtMinor !== null || multiple === undefined || biggest === null || biggest <= 0)
    return null;
  return Math.floor(biggest * multiple);
}

/** The agency's target among branches for him: the top tier's when he is of it and hot enough, else the common one. */
function targetOf(input: StepPriceInput): { readonly multiple: number; readonly topTier: boolean } | null {
  const setting = input.setting;
  if (setting === undefined) return null;
  const { topTierTargetMultiple, topTierMinDesire, targetMultiple } = setting;
  if (
    input.fanTier === TOP_TIER &&
    topTierTargetMultiple !== undefined &&
    topTierMinDesire !== undefined &&
    input.desire >= topTierMinDesire
  )
    return { multiple: topTierTargetMultiple, topTier: true };
  return targetMultiple === undefined ? null : { multiple: targetMultiple, topTier: false };
}

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
    return { kind: 'stop', reason: above.length > 0 ? 'capped_at_start' : 'limit_reached', capMinor };
  const capped = fitting.length < above.length;
  const offer = (
    chosen: { readonly priceMinor: number; readonly branch: number },
    reason: Exclude<StepPriceReason, 'limit_reached'>,
  ): StepPriceChoice => ({ kind: 'offer', ...chosen, reason, capMinor });
  if (fitting.length === 1) return offer(first, capped ? 'capped_at_start' : 'next_step');
  // The start (nothing bought in the run): the agency's order, the default first; the cap may push it to a cheaper one.
  if (input.lastBoughtMinor === null) {
    if (!capped) return offer(first, 'next_step');
    const highest = fitting.reduce((best, one) => (one.priceMinor > best.priceMinor ? one : best), first);
    return offer(highest, 'capped_at_start');
  }
  const target = targetOf(input);
  // No target set: the agency's order, the first branch that climbs.
  if (target === null) return offer(first, 'next_step');
  const aim = input.lastBoughtMinor * target.multiple;
  // The closest to the target; between two as close, the cheaper.
  const closest = fitting.reduce((best, one) => {
    const gap = Math.abs(one.priceMinor - aim);
    const bestGap = Math.abs(best.priceMinor - aim);
    return gap < bestGap || (gap === bestGap && one.priceMinor < best.priceMinor) ? one : best;
  }, first);
  return offer(closest, target.topTier ? 'branch_target_top_tier' : 'branch_target');
}
