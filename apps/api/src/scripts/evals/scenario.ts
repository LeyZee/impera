import { DesireBandSchema, ObjectionKindSchema, ObjectionReplyIdSchema } from '@impera/contracts';
import { BRAIN_ALERTS_MAX, BriefSchema, JudgeCriterionSchema, SCRIPT_REPLIES } from '@impera/llm';
import { parse } from 'yaml';
import { z } from 'zod';

const Risk = BriefSchema.shape.risks.element;
const Intent = BriefSchema.shape.intent;
const Action = BriefSchema.shape.action;
const DesireSignal = BriefSchema.shape.desireSignals.unwrap().element;

/** A name the scenario gives one of her scripts (ADR 0098), its ref on the made-up platform. */
const ScriptRef = z.string().regex(/^[a-z][a-z0-9-]*$/u);

/**
 * Her made-up catalogue, his run as stored and what Reveal says he was sent and bought (ADR 0098): the long sales
 * scenarios play one message of his at a given point of the staircase. A purchase is Reveal's `bought`, never his word.
 */
const ScriptsSchema = z
  .object({
    catalogue: z
      .array(
        z
          .object({
            ref: ScriptRef,
            moment: z.enum(['day', 'night']).nullable().default(null),
            description: z.string().min(1),
            steps: z
              .array(
                z
                  .object({
                    kind: z.enum(['free', 'paid', 'bridge']),
                    price_euros: z.number().positive().optional(),
                    instruction: z.string().min(1).optional(),
                    media: z.string().min(1).optional(),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
    /** His latest run as stored: its steps by index, their kind and price read from the catalogue. */
    run: z
      .object({
        script: ScriptRef,
        status: z.enum(['open', 'bought_out', 'refused', 'stalled', 'closed_by_human']).default('open'),
        steps: z
          .array(
            z
              .object({
                index: z.int().nonnegative(),
                outcome: z.enum(['sent', 'opened', 'bought', 'refused']),
              })
              .strict(),
          )
          .default([]),
        ignored_messages: z.int().nonnegative().default(0),
        started_minutes_ago: z.number().nonnegative().default(20),
      })
      .strict()
      .optional(),
    /** What Reveal says: per script, the step indexes sent and bought. */
    history: z
      .array(
        z
          .object({
            script: ScriptRef,
            sent: z.array(z.int().nonnegative()).default([]),
            bought: z.array(z.int().nonnegative()).default([]),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type ScenarioScripts = z.infer<typeof ScriptsSchema>;

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
        /** A chatter is on shift on her accounts (ADR 0090 § A: a custom order goes to them). */
        chatter_on_shift: z.boolean().default(false),
        /** A custom order of his already waits for the team. */
        custom_order_open: z.boolean().default(false),
        /** The replies of her objection bank he already received, by id (ADR 0090 § B). */
        objection_replies_used: z.array(ObjectionReplyIdSchema).default([]),
        /**
         * His availability as stored just before this message (ADR 0103, amendement du 13/11): `confirmed`, he said a
         * few minutes ago that he is alone and free; `no`, that someone is beside him.
         */
        availability: z.enum(['confirmed', 'unknown', 'no']).default('unknown'),
        /** A message of his sexualized a few minutes ago, in this session (the gate before a script). */
        sexualized: z.boolean().default(false),
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
    scripts: ScriptsSchema.optional(),
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
            /** What he opposes to a price, among these (ADR 0090 § B). */
            objection_in: z.array(ObjectionKindSchema).min(1).optional(),
            /** What his message does with the step waiting, among these (ADR 0098 § 9); `none`: nothing. */
            script_reply_in: z
              .array(z.enum([...SCRIPT_REPLIES, 'none']))
              .min(1)
              .optional(),
          })
          .strict()
          .optional(),
        decision: z
          .object({
            handoff: z.boolean().optional(),
            offer: z.boolean().optional(),
            /** His desire band after this message, among these (P3-12). */
            desire_band_in: z.array(DesireBandSchema).min(1).optional(),
            /** What code did with a custom order (ADR 0090 § A): `none` when he asked for none. */
            custom_order: z.enum(['none', 'handoff', 'reply']).optional(),
            /** The reply of her objection bank given to the voice, by id; `null`: none (ADR 0090 § B). */
            objection_reply: ObjectionReplyIdSchema.nullable().optional(),
            /** What code decided with her scripts (ADR 0098 § 4), among these. */
            script_in: z
              .array(z.enum(['none', 'start', 'send_step', 'wait', 'after_refusal', 'end']))
              .min(1)
              .optional(),
            /** The step decided, by its index, and of which script (`start`, `send_step`). */
            script_step: z.object({ script: ScriptRef, index: z.int().nonnegative() }).strict().optional(),
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
