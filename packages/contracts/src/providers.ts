import { z } from 'zod';

import { refusalBodySchema } from './errors';
import { pastedSecret } from './pasted-secret';

/**
 * AI services connected from Réglages > Modèles IA (ADR 0016, task P3-03). A key never crosses the API outwards:
 * only its state, its label at the provider and what the verification found.
 */

/** Grok runs on xAI, Gemini on Google, voice notes on ElevenLabs; Mistral and Venice are fallbacks. */
export const AiProviderSchema = z.enum(['xai', 'google', 'elevenlabs', 'mistral', 'venice']);
export type AiProvider = z.infer<typeof AiProviderSchema>;

export const ProviderConnectionStateSchema = z.enum([
  'not_connected',
  'connected',
  'low_credit',
  'needs_reconnect',
]);
export type ProviderConnectionState = z.infer<typeof ProviderConnectionStateSchema>;

/** Why a key was refused; each kind has exactly one French sentence (domain/messages.ts in the providers module). */
export const ProviderErrorKindSchema = z.enum([
  'too_short',
  'wrong_provider',
  'unauthorized',
  'model_not_allowed',
  'no_credit',
  'api_not_enabled',
  'vision_model_missing',
  'missing_permission',
  'unreachable',
]);
export type ProviderErrorKind = z.infer<typeof ProviderErrorKindSchema>;

/** Where the key in use comes from: the dashboard, or the environment outside production only. */
export const ProviderKeySourceSchema = z.enum(['dashboard', 'environment']);
export type ProviderKeySource = z.infer<typeof ProviderKeySourceSchema>;

export const ProviderFactSchema = z.object({ label: z.string().min(1), value: z.string().min(1) });
export type ProviderFact = z.infer<typeof ProviderFactSchema>;

export const ProviderVoiceSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
export type ProviderVoice = z.infer<typeof ProviderVoiceSchema>;

/** Choices stored with a key: the Gemini model resolved at connection, the ElevenLabs voice. */
export const ProviderSettingsSchema = z.object({
  visionModel: z.string().min(1).optional(),
  voice: ProviderVoiceSchema.optional(),
});
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;

/**
 * What went wrong with a service's calls, in the owner's words (ADR 0091 § 7): only what says something of the
 * connection, never a model's refusal or a malformed answer.
 * `no_credit`: no credit or quota left (402, or a body that says so); `key_refused`: 401/403; `model_missing`: the
 * model is not on the account; `rate_limited`: too many calls (429); `timeout`; `not_answering`: 5xx, network.
 */
export const ProviderTroubleSchema = z.enum([
  'no_credit',
  'key_refused',
  'model_missing',
  'rate_limited',
  'timeout',
  'not_answering',
]);
export type ProviderTrouble = z.infer<typeof ProviderTroubleSchema>;

/**
 * « Essai réel » (ADR 0091 § 7): one tiny real call the owner asks for. `answers`: the service generated; `budget_reached`:
 * the day's cap stopped it before any call; `no_voice`: ElevenLabs has no voice to speak with.
 */
export const ProviderProbeOutcomeSchema = z.enum([
  'answers',
  'budget_reached',
  'no_voice',
  ...ProviderTroubleSchema.options,
]);
export type ProviderProbeOutcome = z.infer<typeof ProviderProbeOutcomeSchema>;

export const ProviderProbeSchema = z.object({
  at: z.iso.datetime(),
  outcome: ProviderProbeOutcomeSchema,
  /** How long the provider took to answer; null when no call was made. */
  latencyMs: z.number().int().nonnegative().nullable(),
  /** The model tried (« Grok 4.7 »), as the screen names it; null when no call was made. */
  model: z.string().min(1).nullable(),
});
export type ProviderProbe = z.infer<typeof ProviderProbeSchema>;

/** A service's real calls over the last 24 hours (`llm_calls`, ADR 0091 § 7). ElevenLabs has none. */
export const ProviderActivitySchema = z.object({
  calls: z.number().int().nonnegative(),
  /** Calls that failed for one of `ProviderTroubleSchema`'s reasons. */
  troubled: z.number().int().nonnegative(),
  /** Calls this service made in place of the main model (Mistral for Grok, Grok for Gemini). */
  asFallback: z.number().int().nonnegative(),
  lastSuccessAt: z.iso.datetime().nullable(),
  /** The latest trouble, even older than 24 hours (7 days at most); null when there is none or a success came since. */
  lastTrouble: z.object({ at: z.iso.datetime(), kind: ProviderTroubleSchema }).nullable(),
});
export type ProviderActivity = z.infer<typeof ProviderActivitySchema>;

/** ElevenLabs' characters of the month, as its last check read them. */
export const ProviderQuotaSchema = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  resetsAt: z.iso.datetime().nullable(),
  plan: z.enum(['free', 'paid']).nullable(),
});
export type ProviderQuota = z.infer<typeof ProviderQuotaSchema>;

/** One line of the Services section, as the dashboard reads it. */
export const ProviderStatusSchema = z.object({
  provider: AiProviderSchema,
  state: ProviderConnectionStateSchema,
  source: ProviderKeySourceSchema.nullable(),
  keyLabel: z.string().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  /**
   * The saved key no longer decrypts (its encryption key was dropped too early): Impera cannot check it, the
   * provider is never called, and only pasting it again fixes it.
   */
  isUnreadable: z.boolean(),
  /** The one sentence the line shows: what is lost without the service, or what works. */
  message: z.string().min(1),
  facts: z.array(ProviderFactSchema),
  settings: ProviderSettingsSchema,
  /** The voices of the ElevenLabs account, for the voice picker; empty for the other services. */
  voices: z.array(ProviderVoiceSchema),
  /** The last « Essai réel », null before the first one or once the key changed. */
  probe: ProviderProbeSchema.nullable(),
  /** Its calls over 24 hours; null for a service the journal does not see (ElevenLabs) or not connected. */
  activity: ProviderActivitySchema.nullable(),
  /** ElevenLabs only: the month's characters. */
  quota: ProviderQuotaSchema.nullable(),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

/** Keys are long random strings; 512 characters leaves room and stops abuse of the route. */
export const SaveProviderKeyBodySchema = z.object({ key: pastedSecret(512) });
export type SaveProviderKeyBody = z.infer<typeof SaveProviderKeyBodySchema>;

/** A key the provider (or the shape check) turned down, as the sheet shows it under the key field. */
export const ProviderRefusalSchema = z.object({ kind: ProviderErrorKindSchema, message: z.string().min(1) });
export type ProviderRefusal = z.infer<typeof ProviderRefusalSchema>;

/** 422 of `PUT /v1/settings/providers/:provider/key`: the refusal in the common body (MOT-13). */
export const PROVIDER_KEY_UNPROCESSABLE = 'provider_key_unprocessable';
export const ProviderRefusalBodySchema = refusalBodySchema(ProviderErrorKindSchema);

/** The one thing the top of the Services section asks for, with its single neon button. */
export const ProviderNextActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.enum(['replace_key', 'top_up', 'connect']),
    provider: AiProviderSchema,
    lead: z.string().min(1),
    detail: z.string().min(1),
  }),
  z.object({ kind: z.literal('all_set'), lead: z.string().min(1), detail: z.string().min(1) }),
]);
export type ProviderNextAction = z.infer<typeof ProviderNextActionSchema>;

/** `GET /v1/settings/providers`: the lines in display order and what to do next. */
export const ProviderOverviewSchema = z.object({
  services: z.array(ProviderStatusSchema),
  next: ProviderNextActionSchema,
});
export type ProviderOverview = z.infer<typeof ProviderOverviewSchema>;
