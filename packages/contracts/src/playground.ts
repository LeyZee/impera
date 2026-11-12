import { z } from 'zod';

import { BriefIntentSchema } from './brief';
import { DESIRE_SIGNALS_MAX, DesireBandSchema, DesireScoreSchema, DesireSignalSchema } from './desire';
import { CreatorIdSchema, PersonaVersionIdSchema } from './ids';
import { MediaDescriptionSchema } from './media';

/**
 * Entraîner > Playground (P3-06): the training screen talks to the calibration engine of P3-05 through
 * `/v1/playground`. One session per signed-in user, in server memory; nothing is ever sent to a fan.
 */

/** Why an answer was rejected; each one has a French label, served in the state so the screen has one source. */
export const REJECT_REASONS = [
  'sounds_ai',
  'out_of_character',
  'too_long',
  'too_early_sexual',
  'missed_sale',
  'forgot_fact',
  'other',
] as const;
export const RejectReasonSchema = z.enum(REJECT_REASONS);
export type RejectReason = z.infer<typeof RejectReasonSchema>;

/** Where a rating goes: a voice example, a rule for Charles to approve then code, a test replayed on change. */
export const DestinationSchema = z.enum(['voice_example', 'rule', 'test']);
export type Destination = z.infer<typeof DestinationSchema>;

export const VerdictSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('validated') }),
  z.object({ kind: z.literal('corrected'), text: z.string().trim().min(1).max(4_000) }),
  z.object({
    kind: z.literal('rejected'),
    reason: RejectReasonSchema,
    note: z.string().trim().min(1).max(1_000).exactOptional(),
  }),
]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const AnswerVersionSchema = z.object({ voicePrompt: z.string(), voiceModel: z.string() });
export type AnswerVersion = z.infer<typeof AnswerVersionSchema>;

const IsoDateSchema = z.iso.datetime({ offset: true });

export const PlaygroundPresetSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** What the preset puts to the test, in French. */
  tests: z.string(),
  /** A first message to send as that fan. */
  opening: z.string(),
});

export const PlaygroundSituationSchema = z.object({
  now: IsoDateSchema,
  /** Her IANA time zone: day and night follow her clock. */
  timeZone: z.string(),
  relationshipStartedAt: IsoDateSchema,
  spentCents: z.number().int().nonnegative(),
  /** 22:00 to 06:59 her time. */
  isNight: z.boolean(),
});
export type PlaygroundSituation = z.infer<typeof PlaygroundSituationSchema>;

/**
 * His desire score as it stood after one message of his (P3-12, glossary « Note de désir »), shown to calibrate it:
 * the score before and after, and each signal with what it weighed in the counting `weightsVersion`. A signal that
 * resets or freezes the score instead of counting has `points: null`. Computed by the server, never by the screen.
 */
export const PlaygroundDesireSchema = z.object({
  /** His score cooled to this message, before it counted; `null` before his first score. */
  before: DesireScoreSchema.nullable(),
  score: DesireScoreSchema,
  band: DesireBandSchema,
  signals: z
    .array(z.object({ signal: DesireSignalSchema, points: z.number().int().nullable() }))
    .max(DESIRE_SIGNALS_MAX),
  weightsVersion: z.string(),
});
export type PlaygroundDesire = z.infer<typeof PlaygroundDesireSchema>;

export const PlaygroundTurnSchema = z.object({
  index: z.number().int().nonnegative(),
  from: z.enum(['fan', 'creator']),
  text: z.string(),
  media: z.array(z.object({ description: MediaDescriptionSchema, isLocked: z.boolean() })).exactOptional(),
  /** On his messages the brain read: his desire score after it. */
  desire: PlaygroundDesireSchema.exactOptional(),
});

export const GuardViolationSchema = z.object({
  /** Stable code (agent/domain/guards.ts). */
  code: z.string(),
  /** In French, written by the server: the screen shows it as is. */
  label: z.string(),
  severity: z.enum(['blocking', 'soft']),
  match: z.string().exactOptional(),
});

/**
 * A media as the trainer types it: what it shows, in a few words. The server completes the description
 * (no visible anatomy, intensity not visible); `flags` lets the trainer test the handoff to a human.
 */
export const PlaygroundMediaSchema = z.object({
  kind: z.enum(['image', 'video', 'audio']),
  factualDescription: z.string().trim().min(1).max(800),
  flags: MediaDescriptionSchema.shape.flags.exactOptional(),
});
export type PlaygroundMedia = z.infer<typeof PlaygroundMediaSchema>;

export const PlaygroundAnswerSchema = z.object({
  bubbles: z.array(z.string()),
  isBlocked: z.boolean(),
  violations: z.array(GuardViolationSchema),
  /** Safety flags on his media: a human takes over, nothing was written. */
  handoff: z.array(z.string()).exactOptional(),
  trap: z
    .object({ signals: z.array(z.object({ kind: z.string(), source: z.string(), label: z.string() })) })
    .exactOptional(),
  brief: z
    .object({
      intent: BriefIntentSchema,
      sentiment: z.string(),
      risks: z.array(z.string()),
      action: z.string(),
      replyBrief: z.string(),
      kycMissing: z.array(z.string()),
    })
    .exactOptional(),
  /** His desire score after this message, when the brain read it. */
  desire: PlaygroundDesireSchema.exactOptional(),
  /** What the cursor decided on going sexual (P3-09), in French; absent when the brain did not read the moment. */
  cursor: z.object({ kind: z.string(), label: z.string() }).exactOptional(),
  /** The brain wanted to offer a script and the policy said no: why, in French. She wrote a plain answer. */
  offerRefused: z.object({ code: z.string(), label: z.string() }).exactOptional(),
  model: z.string().exactOptional(),
  latencyMs: z.number().nonnegative(),
  /** The cost in euros, at the daily budget's rate (ADR 0011); the journal keeps dollars. */
  costEur: z.number().nonnegative(),
  isFallback: z.boolean(),
  /** Why nothing was written: the models that failed, or the daily cap reached. */
  failure: z.string().exactOptional(),
});
export type PlaygroundAnswer = z.infer<typeof PlaygroundAnswerSchema>;

/**
 * « Taux au playground » (ADR 0019): it calibrates the voice and never opens the automatic mode, which only
 * « le taux en réel » of real drafts and the blind test do.
 */
export const PlaygroundRateSchema = z.object({
  /** Validated as written, out of the last 50 rated answers of the current version; null before any rating. */
  rate: z.number().min(0).max(1).nullable(),
  rated: z.number().int().nonnegative(),
  validated: z.number().int().nonnegative(),
  target: z.number(),
  /** Change in points from the version rated before, once both have ratings. */
  trendPoints: z.number().nullable(),
  previousVersion: AnswerVersionSchema.nullable(),
});
export type PlaygroundRate = z.infer<typeof PlaygroundRateSchema>;

export const PlaygroundStateSchema = z.object({
  /**
   * The persona the playground plays: its first name, and `played`, the creator's version chosen at the head of the
   * screen (recette PRO-21), active or not; `null` for the invented persona (`PLAYGROUND_PERSONA_PATH`, the demo's by
   * default), so that a trainer never takes it for one of the agency's creators (recette 28/10, M13).
   */
  persona: z.object({
    name: z.string().min(1),
    played: z
      .object({ creatorId: CreatorIdSchema, versionId: PersonaVersionIdSchema, version: z.string().min(1) })
      .nullable(),
  }),
  presets: z.array(PlaygroundPresetSchema),
  presetId: z.string().nullable(),
  /**
   * Her two desire thresholds, from her persona: under `open` she never opens the intimate herself, under `script` no
   * script goes out unless he asks for paid content himself.
   */
  desireThresholds: z.object({ open: DesireScoreSchema, script: DesireScoreSchema }),
  situation: PlaygroundSituationSchema,
  fanNotes: z.array(z.string()),
  history: z.array(PlaygroundTurnSchema),
  rate: PlaygroundRateSchema,
  version: AnswerVersionSchema,
  rejectReasons: z.array(z.object({ id: RejectReasonSchema, label: z.string() })),
  /** The session's cost in euros, at the daily budget's rate (ADR 0011). */
  sessionCostEur: z.number().nonnegative(),
  /** Whether a key reaches the voice model, main or fallback: without one, sending a message answers 503. */
  voice: z.object({ reachable: z.boolean() }),
  /** The last answer, until it is rated. */
  pending: PlaygroundAnswerSchema.nullable(),
});
export type PlaygroundState = z.infer<typeof PlaygroundStateSchema>;

export const PlaygroundComparisonSchema = z.object({
  bubbles: z.array(z.string()),
  violations: z.array(GuardViolationSchema),
  isBlocked: z.boolean(),
  model: z.string().exactOptional(),
  costEur: z.number().nonnegative(),
  failure: z.string().exactOptional(),
});
export type PlaygroundComparison = z.infer<typeof PlaygroundComparisonSchema>;

export const PlaygroundRatingResultSchema = z.object({
  rate: PlaygroundRateSchema,
  destination: DestinationSchema.nullable(),
});
export type PlaygroundRatingResult = z.infer<typeof PlaygroundRatingResultSchema>;

// Request bodies.
/**
 * `POST /v1/playground/persona` (recette PRO-21): the persona the trainer talks to, a version of a creator, active or
 * not, or the invented one. The conversation starts over; the ratings that follow are that creator's. Unknown
 * version: 404 `playground_persona_not_found`.
 */
export const PlaygroundPersonaBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('invented') }),
  z.strictObject({
    kind: z.literal('version'),
    creatorId: CreatorIdSchema,
    versionId: PersonaVersionIdSchema,
  }),
]);
export type PlaygroundPersonaBody = z.infer<typeof PlaygroundPersonaBodySchema>;
export const PlaygroundPresetBodySchema = z.object({ presetId: z.string().min(1) });
export const PlaygroundMessageBodySchema = z
  .object({
    text: z.string().trim().max(4_000),
    media: z.array(PlaygroundMediaSchema).max(10).exactOptional(),
  })
  .refine((body) => body.text !== '' || (body.media?.length ?? 0) > 0, {
    message: 'Un texte ou un média',
    path: ['text'],
  });
export const PlaygroundRatingBodySchema = z
  .object({
    verdict: VerdictSchema,
    /** Overrides the suggested destination; none for a validated answer. */
    destination: DestinationSchema.exactOptional(),
  })
  .refine((body) => body.verdict.kind !== 'validated' || body.destination === undefined, {
    message: 'Une réponse validée n’a pas de destination',
    path: ['destination'],
  });
export const PlaygroundBranchBodySchema = z.object({ fanMessageNumber: z.number().int().min(1) });
export const PlaygroundCompareBodySchema = z.object({ voiceModel: z.string().min(1) });
export const PlaygroundSituationBodySchema = z.object({
  spentCents: z.number().int().nonnegative().exactOptional(),
  timeZone: z.string().min(1).exactOptional(),
  relationshipAgeHours: z
    .number()
    .nonnegative()
    .max(24 * 365)
    .exactOptional(),
  /** « 23:30 »: moves to the next time her clock shows it, across a change of daylight saving time. */
  localTime: z
    .string()
    .regex(/^([01]?\d|2[0-3]):[0-5]\d$/)
    .exactOptional(),
});
export type PlaygroundSituationPatch = z.infer<typeof PlaygroundSituationBodySchema>;
export const PlaygroundAdvanceBodySchema = z.object({
  hours: z
    .number()
    .positive()
    .max(24 * 30),
});
export const PlaygroundNotesBodySchema = z.object({ notes: z.array(z.string().max(500)).max(200) });
export const PlaygroundCreatorMediaBodySchema = PlaygroundMediaSchema.extend({ isLocked: z.boolean() });

/** Codes of the playground routes (suffix rules of errors.ts; 503 is set by the route itself). */
export const PLAYGROUND_ERROR_CODES = [
  'llm_unavailable',
  'nothing_to_rate_conflict',
  'nothing_to_compare_conflict',
  'answer_in_progress_conflict',
  'blocked_answer_conflict',
  'preset_not_found',
  'fan_message_not_found',
  'voice_model_invalid',
  'time_zone_invalid',
  'playground_persona_not_found',
] as const;
export type PlaygroundErrorCode = (typeof PLAYGROUND_ERROR_CODES)[number];
