import {
  BriefIntentSchema,
  CustomOrderReadingFromModelSchema,
  CustomOrderReadingSchema,
  CHANNEL_POLL_OPTION_MAX,
  CHANNEL_POLL_OPTIONS_MAX,
  CHANNEL_POLL_OPTIONS_MIN,
  CHANNEL_POLL_QUESTION_MAX,
  DESIRE_BRAIN_SIGNALS,
  DropMediaDescriptionSchema,
  OutfitSchema,
  MediaDescriptionSchema,
  ObjectionKindSchema,
  TrendCaptureDescriptionSchema,
} from '@impera/contracts';
import { z } from 'zod';

/** Her alerts the brain reads at most, and how it names them (`a1`, `a2`…): short ids, never her alert's own. */
export const BRAIN_ALERTS_MAX = 50;
const BRAIN_ALERT_ID = /^a[1-9]\d?$/;
export const brainAlertId = (index: number): string => `a${String(index + 1)}`;

/** The scripts she may open with him that the brain reads at most, and how it names them (`s1`, `s2`…, ADR 0098 § 6). */
export const BRAIN_SCRIPTS_MAX = 20;
const BRAIN_SCRIPT_ID = /^s[1-9]\d?$/;
export const brainScriptId = (index: number): string => `s${String(index + 1)}`;

/**
 * What his last message does with the script step waiting for him (ADR 0098 § 9): a clear no, an answer to it, or he
 * says he bought it. Read by the brain, decided by code; « bought » is only ever Reveal's to say.
 */
export const SCRIPT_REPLIES = ['refused', 'answers_step', 'claims_bought'] as const;

/** Brain output (docs/architecture/ai-engine.md, « Le Brief »). Decisions are taken by the policy in code, not here. */
/** The moments the code answers by rule (Charles 21/11), read by the brain. */
const BRIEF_OCCASIONS = ['says_love', 'asks_proof', 'partner_returns', 'unsolicited_explicit'] as const;

export const BriefSchema = z.object({
  intent: BriefIntentSchema,
  /** What he opposes to a price, with `price_objection` only (ADR 0090 § 7): the code picks her reply from it. */
  objection: ObjectionKindSchema.optional(),
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
      'insult',
      'self_harm',
      'money_trouble',
      'no_budget',
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
  /**
   * The script that fits him best among those the prompt listed, by its id (`s1`…, ADR 0098 § 6): the code keeps only
   * an id it gave, and decides whether one opens. Absent, none.
   */
  scriptPick: z.string().regex(BRAIN_SCRIPT_ID).optional(),
  /** What his last message does with the script step waiting for him, when the prompt says one waits. */
  scriptReply: z.enum(SCRIPT_REPLIES).optional(),
  /**
   * What his custom request asks (ADR 0159 § A.2), read into closed boxes when he asks for one or speaks of the one
   * open: the format, her supplements by the ids the prompt gave, the minutes, the details he gave. Never a price; the
   * code decides what is missing and when the card goes to her. Absent, nothing read.
   */
  customOrder: CustomOrderReadingSchema.optional(),
  /** He asks where or when her next party or outing is (Charles 21/11). Absent, he does not. */
  asksHerNextParty: z.boolean().optional(),
  /** He comes back, or apologises, after insulting or belittling her earlier in the conversation (Charles 21/11). */
  returnsAfterInsult: z.boolean().optional(),
  /**
   * A moment the code answers by rule (Charles 21/11): he says he loves her, asks a proof she is real, says his partner
   * is coming home, or sends an explicit photo of himself unasked. Absent, none.
   */
  occasion: z.enum(BRIEF_OCCASIONS).optional(),
  action: z.enum(['reply', 'offer', 'wait', 'follow_up', 'handoff']),
  replyBrief: z.string().min(1),
  toneHints: z.array(z.string()),
  /** A fact from the fan notes worth bringing back now (« et ton chantier, ça avance ? »). */
  callback: z.string().min(1).optional(),
  /** A detail of her own sheet she could confide, to invite a confidence in return. */
  selfDisclosure: z.string().min(1).optional(),
});
export type Brief = z.infer<typeof BriefSchema>;

/** The brief's lists: a model that writes `null` for one means none. */
const BRIEF_LISTS = new Set(['factsProposed', 'kycMissing', 'risks', 'toneHints']);

/**
 * The brief as a model may write it (16/11, relevé du PC: the Mistral fallback failed the format 26 times in 26): a
 * facultative field written `null` or `""`, or a list written `null`, reads as absent or empty, then the brief is read
 * strictly. The model is shown this shape (`io: "input"`), so `null` is allowed to it; the code only ever sees a
 * `Brief`.
 */
export const BriefFromModelSchema = BriefSchema.extend({
  objection: ObjectionKindSchema.nullish(),
  factsProposed: BriefSchema.shape.factsProposed.nullable(),
  kycMissing: BriefSchema.shape.kycMissing.nullable(),
  risks: BriefSchema.shape.risks.nullable(),
  desireSignals: z.array(z.enum(DESIRE_BRAIN_SIGNALS)).max(DESIRE_BRAIN_SIGNALS.length).nullish(),
  alertsSeen: z.array(z.string().regex(BRAIN_ALERT_ID)).max(BRAIN_ALERTS_MAX).nullish(),
  scriptPick: z.union([z.string().regex(BRAIN_SCRIPT_ID), z.literal('')]).nullish(),
  scriptReply: z.enum(SCRIPT_REPLIES).nullish(),
  customOrder: CustomOrderReadingFromModelSchema.nullish(),
  asksHerNextParty: z.boolean().nullish(),
  returnsAfterInsult: z.boolean().nullish(),
  occasion: z.enum(BRIEF_OCCASIONS).nullish(),
  toneHints: BriefSchema.shape.toneHints.nullable(),
  callback: z.string().nullish(),
  selfDisclosure: z.string().nullish(),
})
  .transform((brief): unknown =>
    Object.fromEntries(
      Object.entries(brief).flatMap(([key, value]) =>
        value === null || (typeof value === 'string' && value.trim() === '' && key !== 'replyBrief')
          ? BRIEF_LISTS.has(key)
            ? [[key, []]]
            : []
          : [[key, value]],
      ),
    ),
  )
  .pipe(BriefSchema);

export const VoiceOutputSchema = z.object({
  bubbles: z.array(z.string().min(1)).min(1).max(6),
  /**
   * Her answer in French, one bubble per bubble, when she writes in another language (ADR 0168 § 9): for the team
   * only. Loose on purpose: a translation that does not fit is dropped by the code, never the answer.
   */
  translation: z.array(z.string()).optional(),
});
export type VoiceOutput = z.infer<typeof VoiceOutputSchema>;

/** The most characters of his message the translation for the nets reads, and of the French it writes. */
export const FAN_TRANSLATION_TEXT_MAX = 2_000;

/**
 * His message in French, for the nets only (ADR 0168 § 5, amended 27/11): a closed object with one field, never sent,
 * never shown, never kept. French is the only target: no field of the request chooses another.
 */
export const FanTranslationSchema = z
  .object({ french: z.string().max(FAN_TRANSLATION_TEXT_MAX * 2) })
  .strict();
export type FanTranslation = z.infer<typeof FanTranslationSchema>;

/** What the sense model writes; the gateway adds the version, the kind and the duration it already knows. */
export const SenseOutputSchema = MediaDescriptionSchema.omit({
  vocabularyVersion: true,
  kind: true,
  durationS: true,
});

/** A drop's media described in detail (ADR 0083): the senses' output and `detailed`. */
export const DropSenseOutputSchema = DropMediaDescriptionSchema.omit({
  vocabularyVersion: true,
  kind: true,
  durationS: true,
}).extend({
  // Always asked of the model (vocabulary 1.1.0): only a description written before may lack it.
  outfit: OutfitSchema.nullable(),
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

/** The vision's reading of a marked post's captures (ADR 0060 § 2): the contract's fields, extra ones dropped. */
export const TrendCapturesOutputSchema = z.object(TrendCaptureDescriptionSchema.shape);

/** Telegram holds a media's caption to 1 024 characters, the link included: the text keeps room for it. */
export const CHANNEL_POST_TEXT_MAX = 800;

/**
 * A post of her channel (ADR 0080 § 5): her text, with `**bold**` and `__underline__` marked as Telegram shows them;
 * the code escapes it, renders the marks and adds the link.
 */
export const ChannelPostOutputSchema = z.object({ text: z.string().min(1).max(CHANNEL_POST_TEXT_MAX) });
export type ChannelPostOutput = z.infer<typeof ChannelPostOutputSchema>;

/** A poll of her channel (ADR 0080 § 5.7): a question and two to four answers, in her voice. */
export const ChannelPollOutputSchema = z.object({
  question: z.string().min(1).max(CHANNEL_POLL_QUESTION_MAX),
  options: z
    .array(z.string().min(1).max(CHANNEL_POLL_OPTION_MAX))
    .min(CHANNEL_POLL_OPTIONS_MIN)
    .max(CHANNEL_POLL_OPTIONS_MAX),
});
export type ChannelPollOutput = z.infer<typeof ChannelPollOutputSchema>;
