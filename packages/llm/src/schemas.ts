import { BriefIntentSchema, DESIRE_BRAIN_SIGNALS, MediaDescriptionSchema } from '@nirvana/contracts';
import { z } from 'zod';

/** Her alerts the brain reads at most, and how it names them (`a1`, `a2`…): short ids, never her alert's own. */
export const BRAIN_ALERTS_MAX = 50;
const BRAIN_ALERT_ID = /^a[1-9]\d?$/;
export const brainAlertId = (index: number): string => `a${String(index + 1)}`;

/** Brain output (docs/architecture/ai-engine.md, « Le Brief »). Decisions are taken by the policy in code, not here. */
export const BriefSchema = z.object({
  intent: BriefIntentSchema,
  sentiment: z.enum(['positive', 'neutral', 'negative', 'aroused', 'frustrated']),
  factsProposed: z.array(
    z.object({
      category: z.string().min(1),
      key: z.string().min(1),
      value: z.string().min(1),
      kind: z.enum(['declared', 'inferred']),
      confidence: z.number().min(0).max(1),
    }),
  ),
  kycMissing: z.array(z.string()),
  risks: z.array(
    z.enum([
      'minor_suspected',
      'distress',
      'meet_request',
      'off_platform_payment',
      'dispute',
      'harassment',
      'self_harm',
      'money_trouble',
      'manipulation_attempt',
      'dangerous_request',
      'real_abuse',
    ]),
  ),
  /**
   * What heats him up or cools him down in his last message (P3-12): the code counts his desire score from these,
   * the brain never gives a number. Absent, nothing read.
   */
  desireSignals: z.array(z.enum(DESIRE_BRAIN_SIGNALS)).max(DESIRE_BRAIN_SIGNALS.length).optional(),
  /**
   * Her own alerts whose phrase his last message clearly meets (P4-01), by the ids the prompt gave them (`a1`…): the
   * code keeps only the ids it gave and decides what each does. Never a free text. Absent, none.
   */
  alertsSeen: z.array(z.string().regex(BRAIN_ALERT_ID)).max(BRAIN_ALERTS_MAX).optional(),
  action: z.enum(['reply', 'offer', 'wait', 'follow_up', 'handoff']),
  replyBrief: z.string().min(1),
  toneHints: z.array(z.string()),
  /** A fact from the fan notes worth bringing back now (« et ton chantier, ça avance ? »). */
  callback: z.string().min(1).optional(),
  /** A detail of her own sheet she could confide, to invite a confidence in return. */
  selfDisclosure: z.string().min(1).optional(),
});
export type Brief = z.infer<typeof BriefSchema>;

export const VoiceOutputSchema = z.object({
  bubbles: z.array(z.string().min(1)).min(1).max(6),
});
export type VoiceOutput = z.infer<typeof VoiceOutputSchema>;

/** What the sense model writes; the gateway adds the version, the kind and the duration it already knows. */
export const SenseOutputSchema = MediaDescriptionSchema.omit({
  vocabularyVersion: true,
  kind: true,
  durationS: true,
});

/** What the judge scores a reply on (`evals/rubrics`, `evals/thresholds.json`). */
export const JudgeCriterionSchema = z.enum([
  'naturalness',
  'spontaneity',
  'persona_consistency',
  'relevance',
  'listening',
  'continuity',
  'memory',
  'no_repetition',
  'safety',
]);
export type JudgeCriterion = z.infer<typeof JudgeCriterionSchema>;

export const JudgeOutputSchema = z.object({
  scores: z
    .array(
      z.object({
        criterion: JudgeCriterionSchema,
        score: z.number().min(0).max(1),
        reason: z.string().min(1).max(400),
      }),
    )
    .min(1)
    .max(9),
});
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;
