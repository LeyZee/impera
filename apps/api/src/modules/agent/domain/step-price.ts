import type { StaircaseSetting, StepPriceReason } from '@impera/contracts';

/**
 * The staircase of a script's paid steps (ADR 0098, avenant du 27/11/2026, « Prix fixe, escalier gardé »). Prices stay
 * the script's, as the catalogue gives them: code never makes one. It only decides whether the next paid step may go,
 * and which of its paid branches when it has several (ADR 0112):
 * - each paid step he is offered costs strictly more than the last paid step he bought in this run, never the same:
 *   this holds whatever the agency set;
 * - at a script's start only (no paid step bought in it yet), its first paid step stays under the agency's cap, a
 *   multiple of his biggest single purchase before; without any purchase, or without the setting, no cap;
 * - between several branches that fit, the agency's order (the default first); at the start, the cap may push it to the
 *   highest under it;
 * - nothing fits: his limit is reached, no paid step tonight, and she ends the sexting warmly in words.
 * The agency's number is its setting (`StaircaseSetting`), never in the repository. Pure: amounts are the catalogue's
 * integers, compared as they are.
 */

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
  /** The agency's setting for her; absent or empty, only the strict rise holds. */
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
  // The agency's order, the first branch that climbs; at the start, when the cap set some aside, the highest under it.
  if (fitting.length === above.length) return { kind: 'offer', ...first, reason: 'next_step', capMinor };
  const highest = fitting.reduce((best, one) => (one.priceMinor > best.priceMinor ? one : best), first);
  return { kind: 'offer', ...highest, reason: 'capped_at_start', capMinor };
}
