import { DesireBandSchema } from '@nirvana/contracts';
import { BRAIN_ALERTS_MAX, BriefSchema, JudgeCriterionSchema } from '@nirvana/llm';
import { parse } from 'yaml';
import { z } from 'zod';

const Risk = BriefSchema.shape.risks.element;
const Intent = BriefSchema.shape.intent;
const Action = BriefSchema.shape.action;
const DesireSignal = BriefSchema.shape.desireSignals.unwrap().element;

/** A name the scenario gives one of her alerts, to say which the brain must see. */
const AlertName = z.string().regex(/^[a-z][a-z0-9_]*$/u);

const Regex = z.string().refine((source) => {
  try {
    new RegExp(source, 'iu');
    return true;
  } catch {
    return false;
  }
}, 'not a valid regular expression');

/**
 * One eval scenario (`evals/{scenarios,adversarial,regression}/*.yaml`, playbook `write-an-eval.md`). Fictional fan,
 * fictional messages (ADR 0010); the persona is the demo one unless a version is given.
 */
const ScenarioSchema = z
  .object({
    description: z.string().min(1),
    persona_version: z.literal('demo'),
    /** `smoke` runs every night; `full` only with `--full` (playbook: smoke stays at 30 or fewer). */
    tier: z.enum(['smoke', 'full']).default('smoke'),
    fan_facts: z.array(z.string().min(1)).default([]),
    /** Where they are: written by code, the brain reads it as trusted context. */
    situation: z
      .object({
        known_hours: z.number().nonnegative().default(1),
        spent_euros: z.number().nonnegative().default(0),
        /** Her local time, `HH:MM` (Europe/Paris). */
        local_time: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .default('20:00'),
        age_confirmed: z.boolean().default(false),
        last_offer_hours_ago: z.number().nonnegative().nullable().default(null),
        has_no_budget: z.boolean().default(false),
        sales_frozen: z.boolean().default(false),
        /** His desire score as stored just before this message (P3-12); the engine counts this one on top. */
        desire: z.int().min(0).max(100).default(0),
      })
      .strict()
      .prefault({}),
    history: z
      .array(z.object({ from: z.enum(['fan', 'creator']), text: z.string().min(1) }).strict())
      .default([]),
    /** Her alerts written as a phrase (P4-01), given to the brain as on a real message; names are the scenario's. */
    alerts: z
      .array(z.object({ name: AlertName, phrase: z.string().min(1) }).strict())
      .max(BRAIN_ALERTS_MAX)
      .refine((list) => new Set(list.map((a) => a.name)).size === list.length, 'alert name repeated')
      .default([]),
    /** His message, or several in a row since her last answer. */
    inbound: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    expect: z
      .object({
        brief: z
          .object({
            risks_contain: z.array(Risk).optional(),
            risks_absent: z.array(Risk).optional(),
            intent_in: z.array(Intent).min(1).optional(),
            action_in: z.array(Action).min(1).optional(),
            /** Signals of his heat the brain must read in his message (P3-12). */
            desire_signals_contain: z.array(DesireSignal).min(1).optional(),
            /** Exactly the alerts of `alerts` the brain must see, by name (P4-01); `[]`: none. */
            alerts_seen: z.array(AlertName).optional(),
          })
          .strict()
          .optional(),
        decision: z
          .object({
            handoff: z.boolean().optional(),
            offer: z.boolean().optional(),
            /** His desire band after this message, among these (P3-12). */
            desire_band_in: z.array(DesireBandSchema).min(1).optional(),
          })
          .strict()
          .optional(),
        voice: z
          .object({
            bubbles_max: z.number().int().nonnegative().optional(),
            bubbles_min: z.number().int().positive().optional(),
            /** Case-insensitive patterns her answer must not contain. */
            must_not_match: z.array(Regex).optional(),
            /** At least one of these must appear (a question, a callback…). */
            must_match_any: z.array(Regex).optional(),
            /** Criteria the judge scores, beyond the tier's own: per-scenario minima. */
            judge: z.partialRecord(JudgeCriterionSchema, z.number().min(0).max(1)).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();
export type Scenario = z.infer<typeof ScenarioSchema>;

export function readScenario(source: string): Scenario {
  return ScenarioSchema.parse(parse(source));
}

const TierSchema = z.object({
  min_scenarios: z.number().int().positive(),
  criteria: z.partialRecord(JudgeCriterionSchema, z.number().min(0).max(1)),
});
/** `evals/thresholds.json`: never lowered to pass (playbook `write-an-eval.md`). */
export const ThresholdsSchema = z.object({ smoke: TierSchema, full: TierSchema });
