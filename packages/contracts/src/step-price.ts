import { z } from 'zod';

/**
 * The staircase of a script's paid steps (ADR 0098, avenant du 27/11/2026, « Prix fixe, escalier gardé »): prices stay
 * the script's, code only decides whether the next paid step may go, and which paid branch when a step has several.
 * Why, in one closed code each, kept with the draft for the copilot panel:
 * - `next_step`: the step goes at its price, strictly above the last paid step he bought in this run;
 * - `branch_target`: of several paid branches, the one closest to the agency's target from the last step he bought;
 * - `branch_target_top_tier`: the same, with the agency's target for a fan of the top tier who is hot enough;
 * - `capped_at_start`: at a script's start, its first paid step is above the agency's cap on his past purchases: a
 *   cheaper branch is taken, or none;
 * - `limit_reached`: nothing is strictly above the last paid step he bought: no more paid step tonight.
 */
export const STEP_PRICE_REASONS = [
  'next_step',
  'branch_target',
  'branch_target_top_tier',
  'capped_at_start',
  'limit_reached',
] as const;
export const StepPriceReasonSchema = z.enum(STEP_PRICE_REASONS);
export type StepPriceReason = z.infer<typeof StepPriceReasonSchema>;

/** A multiple of a price, entered by the agency: above one. */
const MultipleSchema = z.number().gt(1).max(10);

/**
 * The agency's settings of the staircase, per creator (`creators.settings.staircase`), entered in the CRM by the
 * owner. No value lives in the repository: a setting left out turns its part off (no cap at a script's start, no target
 * among branches, which then follow the agency's order, no tolerance for a branch on his spend). The rule that a paid
 * step costs strictly more than the last one he bought holds whatever is set.
 */
export const StaircaseSettingSchema = z.strictObject({
  /** Among several paid branches, the one closest to this multiple of the last paid step he bought. */
  targetMultiple: MultipleSchema.optional(),
  /** The same for a fan of the top tier of « Fans », once his desire score reaches `topTierMinDesire`. */
  topTierTargetMultiple: MultipleSchema.optional(),
  /** His desire score (0 to 100) from which `topTierTargetMultiple` applies. */
  topTierMinDesire: z.int().min(0).max(100).optional(),
  /** At a script's start, its first paid step costs at most this multiple of his biggest purchase before. */
  startCapMultiple: MultipleSchema.optional(),
  /**
   * In the script editor, a branch on his past spend may jump up to this multiple of the paid step before it without
   * the jump warning; above it, `price_jump_over_setting`.
   */
  spendBranchJumpMultiple: MultipleSchema.optional(),
});
export type StaircaseSetting = z.infer<typeof StaircaseSettingSchema>;

/** The decision on the price of a paid step, codes and cents only (never a text of the AI nor of the fan). */
export const StepPriceTraceSchema = z.strictObject({
  /** The paid step decided on, from 0 (the panel says « Étape N », from 1). */
  stepIndex: z.int().nonnegative(),
  /** Its price, in cents; `null` when no paid step goes (`capped_at_start` without a branch, `limit_reached`). */
  priceMinor: z.int().positive().nullable(),
  reason: StepPriceReasonSchema,
  /** The last paid step he bought in this run, in cents; `null` before his first purchase of it. */
  previousPaidMinor: z.int().positive().nullable(),
  /** The cap at a script's start, in cents, when the agency set one; `null` otherwise. */
  capMinor: z.int().positive().nullable(),
});
export type StepPriceTrace = z.infer<typeof StepPriceTraceSchema>;

/** One label each, for the copilot panel: the cause, in her team's words. */
export const STEP_PRICE_REASON_LABELS: Readonly<Record<StepPriceReason, string>> = {
  next_step: 'Plus chère que la dernière étape qu’il a prise',
  branch_target: 'La branche la plus proche de la cible de l’agence',
  branch_target_top_tier: 'Gros payeur très chaud : la branche la plus proche de sa cible',
  capped_at_start: 'Au lancement : pas au-delà du plafond de l’agence sur ses achats',
  limit_reached: 'Limite atteinte : plus d’étape payante ce soir',
};
