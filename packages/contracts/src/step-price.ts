import { z } from 'zod';

/**
 * The staircase of a script's paid steps (ADR 0098, avenant du 27/11/2026, « Prix fixe, escalier gardé »): prices stay
 * the script's, code only decides whether the next paid step may go, and which paid branch when a step has several.
 * Why, in one closed code each, kept with the draft for the copilot panel:
 * - `next_step`: the step goes at its price, strictly above the last paid step he bought in this run;
 * - `branch_double`: of several paid branches, the one closest to twice the last paid step he bought;
 * - `branch_triple_whale`: the same, toward three times, for a whale who is very hot;
 * - `capped_by_biggest_purchase`: at the start of a script, its first paid step costs more than one and a half times
 *   his biggest purchase before it: a cheaper branch is taken, or none;
 * - `limit_reached`: nothing is strictly above the last paid step he bought: no more paid step tonight.
 */
export const STEP_PRICE_REASONS = [
  'next_step',
  'branch_double',
  'branch_triple_whale',
  'capped_by_biggest_purchase',
  'limit_reached',
] as const;
export const StepPriceReasonSchema = z.enum(STEP_PRICE_REASONS);
export type StepPriceReason = z.infer<typeof StepPriceReasonSchema>;

/** The decision on the price of a paid step, codes and cents only (never a text of the AI nor of the fan). */
export const StepPriceTraceSchema = z.strictObject({
  /** The paid step decided on, from 0 (the panel says « Étape N », from 1). */
  stepIndex: z.int().nonnegative(),
  /** Its price, in cents; `null` when no paid step goes (`capped_by_biggest_purchase` without a branch, `limit_reached`). */
  priceMinor: z.int().positive().nullable(),
  reason: StepPriceReasonSchema,
  /** The last paid step he bought in this run, in cents; `null` before his first purchase of it. */
  previousPaidMinor: z.int().positive().nullable(),
  /** One and a half times his biggest purchase before the run, in cents, at its start only; `null` otherwise. */
  capMinor: z.int().positive().nullable(),
});
export type StepPriceTrace = z.infer<typeof StepPriceTraceSchema>;

/** One label each, for the copilot panel. */
export const STEP_PRICE_REASON_LABELS: Readonly<Record<StepPriceReason, string>> = {
  next_step: 'Plus cher que la dernière étape qu’il a prise',
  branch_double: 'La branche la plus proche du double de sa dernière étape',
  branch_triple_whale: 'Baleine très chaude : la branche la plus proche du triple',
  capped_by_biggest_purchase: 'Pas plus d’une fois et demie son plus gros achat',
  limit_reached: 'Sa limite est atteinte : plus d’étape payante ce soir',
};
