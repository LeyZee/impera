import { z } from 'zod';

/**
 * The run of a script with one fan (ADR 0098): what the table `script_runs` keeps, read back through these schemas. The
 * rules that move it live in the agent's domain (`script-run.ts`); here, only the words both sides share.
 */

/** Offered (no price), paid (a pack at the catalogue's price), or a bridge between two steps (offered). */
export const SCRIPT_STEP_KINDS = ['free', 'paid', 'bridge'] as const;
export const ScriptStepKindSchema = z.enum(SCRIPT_STEP_KINDS);
export type ScriptStepKind = z.infer<typeof ScriptStepKindSchema>;

/** What became of a step sent to him. */
export const SCRIPT_STEP_OUTCOMES = ['sent', 'opened', 'bought', 'refused'] as const;
export const ScriptStepOutcomeSchema = z.enum(SCRIPT_STEP_OUTCOMES);
export type ScriptStepOutcome = z.infer<typeof ScriptStepOutcomeSchema>;

/** Open, or how it ended: all bought, refused, stalled (no answer, or the hot session over), or a human took over. */
export const SCRIPT_RUN_STATUSES = ['open', 'bought_out', 'refused', 'stalled', 'closed_by_human'] as const;
export const ScriptRunStatusSchema = z.enum(SCRIPT_RUN_STATUSES);
export type ScriptRunStatus = z.infer<typeof ScriptRunStatusSchema>;

/** One step sent, as `script_runs.steps` keeps it. */
export const ScriptRunStepSchema = z.strictObject({
  key: z.string().min(1),
  kind: ScriptStepKindSchema,
  outcome: ScriptStepOutcomeSchema,
  /** In cents, a paid step only. */
  priceCents: z.number().int().positive().nullable(),
  sentAt: z.iso.datetime(),
  at: z.iso.datetime(),
});
export type ScriptRunStep = z.infer<typeof ScriptRunStepSchema>;

export const ScriptRunStepsSchema = z.array(ScriptRunStepSchema);
