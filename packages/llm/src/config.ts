import { z } from 'zod';

const ProviderIdSchema = z.enum(['xai', 'mistral', 'venice', 'google']);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const LlmRoleSchema = z.enum(['voice', 'brain', 'sense', 'judge']);
export type LlmRole = z.infer<typeof LlmRoleSchema>;

const ModelRefSchema = z.object({
  provider: ProviderIdSchema,
  model: z.string().min(1),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

const LlmRoleConfigSchema = ModelRefSchema.extend({
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  fallback: ModelRefSchema.optional(),
});
export type LlmRoleConfig = z.infer<typeof LlmRoleConfigSchema>;

const DailyBudgetSchema = z.object({
  /** Hard cap: past it, no generation at all until her midnight (Charles, 17/10 20h01). */
  capEur: z.number().positive(),
  /**
   * The trend watch's own cap, counted inside `capEur` (ADR 0060 § 7: 1 € a day by default). Past it, only the
   * watch's calls are refused; a fan's answer is never.
   */
  trendWatchCapEur: z.number().positive(),
  /** Share of the cap that raises the alert (0.8: 16 € out of 20 €). */
  alertRatio: z.number().gt(0).lt(1),
  /** The budget day starts at midnight in this zone. */
  timeZone: z.string().min(1),
  /**
   * Dollars per euro, to convert the providers' USD prices. Kept below the market rate on purpose: the spend
   * in euros is overestimated, so the cap stops early rather than late. Update it if the euro falls below it.
   */
  usdPerEur: z.number().positive(),
});
export type DailyBudget = z.infer<typeof DailyBudgetSchema>;

export const LlmConfigSchema = z.object({
  roles: z.record(LlmRoleSchema, LlmRoleConfigSchema),
  /** Transient errors (timeout, 429, 5xx) are retried this many times before the fallback. */
  maxTransientRetries: z.number().int().min(0).max(5),
  dailyBudget: DailyBudgetSchema,
});
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

/**
 * Pinned to a version, never `mistral-large-latest`: an alias moves when Mistral ships, and the model that writes to
 * a fan would change without evals. Moving it is a change of default like any other.
 */
export const MISTRAL_FALLBACK_MODEL = 'mistral-large-4-0';
const MISTRAL_FALLBACK: ModelRef = { provider: 'mistral', model: MISTRAL_FALLBACK_MODEL };

/** Defaults (ADR 0009); per-creator overrides arrive with CreatorSettings.llm. Changing a default needs evals first. */
export const DEFAULT_LLM_CONFIG: LlmConfig = LlmConfigSchema.parse({
  roles: {
    voice: {
      provider: 'xai',
      model: 'grok-4.7',
      temperature: 0.9,
      maxOutputTokens: 400,
      timeoutMs: 30_000,
      fallback: MISTRAL_FALLBACK,
    },
    brain: {
      provider: 'xai',
      model: 'grok-4.7',
      temperature: 0.3,
      maxOutputTokens: 800,
      timeoutMs: 30_000,
      fallback: MISTRAL_FALLBACK,
    },
    // Gemini reads photo, video and sound natively (Charles, 17/10 18h20); when it refuses or blocks, Grok 4.7
    // reads the same media as keyframes plus a transcript. Next fallback: Qwen3-VL (modeles-ia/comparatif-modeles.md).
    sense: {
      provider: 'google',
      model: 'gemini-3.8-flash',
      temperature: 0.2,
      maxOutputTokens: 1_200,
      timeoutMs: 90_000,
      fallback: { provider: 'xai', model: 'grok-4.7' },
    },
    judge: { provider: 'xai', model: 'grok-4.7', temperature: 0, maxOutputTokens: 600, timeoutMs: 60_000 },
  },
  maxTransientRetries: 2,
  dailyBudget: { capEur: 20, trendWatchCapEur: 1, alertRatio: 0.8, timeZone: 'Europe/Paris', usdPerEur: 1.1 },
});

/** API keys from the environment: the fallback outside production (ADR 0016); never logged. */
const ProviderCredentialsSchema = z.object({
  LLM_XAI_API_KEY: z.string().min(1).optional(),
  LLM_MISTRAL_API_KEY: z.string().min(1).optional(),
  LLM_VENICE_API_KEY: z.string().min(1).optional(),
  LLM_GOOGLE_API_KEY: z.string().min(1).optional(),
});
export type ProviderCredentials = z.infer<typeof ProviderCredentialsSchema>;

export function readProviderCredentials(env: Record<string, string | undefined>): ProviderCredentials {
  const nonEmpty = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ''),
  );
  return ProviderCredentialsSchema.parse(nonEmpty);
}

/**
 * Where API keys come from (ADR 0016): the keys a manager saves in Réglages > Modèles IA, stored encrypted
 * per account and kept in server memory so the lookup stays synchronous; the environment
 * (`readProviderCredentials`) only outside production, for development and `pnpm probe`.
 */
export type ApiKeySource = (provider: ProviderId) => string | undefined;
export type ApiKeys = ProviderCredentials | ApiKeySource;

export function apiKeyFor(keys: ApiKeys, provider: ProviderId): string | undefined {
  if (typeof keys === 'function') return keys(provider);
  const credentials = keys;
  switch (provider) {
    case 'xai':
      return credentials.LLM_XAI_API_KEY;
    case 'mistral':
      return credentials.LLM_MISTRAL_API_KEY;
    case 'venice':
      return credentials.LLM_VENICE_API_KEY;
    case 'google':
      return credentials.LLM_GOOGLE_API_KEY;
  }
}
