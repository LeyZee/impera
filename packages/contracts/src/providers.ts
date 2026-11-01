import { z } from 'zod';

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

/** One line of the Services section, as the dashboard reads it. */
export const ProviderStatusSchema = z.object({
  provider: AiProviderSchema,
  state: ProviderConnectionStateSchema,
  source: ProviderKeySourceSchema.nullable(),
  keyLabel: z.string().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
  /**
   * The saved key no longer decrypts (its encryption key was dropped too early): Nirvana cannot check it, the
   * provider is never called, and only pasting it again fixes it.
   */
  isUnreadable: z.boolean(),
  /** The one sentence the line shows: what is lost without the service, or what works. */
  message: z.string().min(1),
  facts: z.array(ProviderFactSchema),
  settings: ProviderSettingsSchema,
  /** The voices of the ElevenLabs account, for the voice picker; empty for the other services. */
  voices: z.array(ProviderVoiceSchema),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

/** Keys are long random strings; 512 characters leaves room and stops abuse of the route. */
export const SaveProviderKeyBodySchema = z.object({ key: z.string().trim().min(1).max(512) });
export type SaveProviderKeyBody = z.infer<typeof SaveProviderKeyBodySchema>;

/** A key the provider (or the shape check) turned down, as the sheet shows it under the key field. */
export const ProviderRefusalSchema = z.object({ kind: ProviderErrorKindSchema, message: z.string().min(1) });
export type ProviderRefusal = z.infer<typeof ProviderRefusalSchema>;

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
