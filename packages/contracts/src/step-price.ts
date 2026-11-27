import { z } from 'zod';

/**
 * The staircase of a script's paid steps (ADR 0098, avenant du 27/11/2026, « Prix fixe, escalier gardé »): prices stay
 * the script's, code only decides whether the next paid step may go. Why, in one closed code each, kept with the draft
 * for the copilot panel:
 * - `next_step`: the step goes at its price, strictly above the last paid step he bought in this run;
 * - `capped_at_start`: at a script's start, its first paid step is above the agency's cap on his biggest purchase: a
 *   cheaper branch is taken, or none;
 * - `limit_reached`: nothing is strictly above the last paid step he bought: no more paid step tonight.
 */
export const STEP_PRICE_REASONS = ['next_step', 'capped_at_start', 'limit_reached'] as const;
export const StepPriceReasonSchema = z.enum(STEP_PRICE_REASONS);
export type StepPriceReason = z.infer<typeof StepPriceReasonSchema>;

/**
 * The agency's setting of the staircase, per creator (`creators.settings.staircase`), entered in the CRM by the owner.
 * No value lives in the repository: left out, there is no cap at a script's start. The rule that a paid step costs
 * strictly more than the last one he bought holds whatever is set.
 */
export const StaircaseSettingSchema = z.strictObject({
  /** At a script's start, its first paid step costs at most this multiple of his biggest purchase before: above one. */
  startCapMultiple: z.number().gt(1).max(10).optional(),
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
  capped_at_start: 'Au lancement\u00a0: pas au-delà du plafond de l’agence sur son plus gros achat',
  limit_reached: 'Limite atteinte\u00a0: plus d’étape payante ce soir',
};
