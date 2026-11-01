import type { LlmConfig, ModelRef, ProviderCredentials } from '@nirvana/llm';

/** A run of the evals never spends more than this, on top of and apart from the agent's daily cap. */
export const EVALS_CAP_EUR = 3;

// Another family than the voice's: a model scoring its own words is too kind to them.
const INDEPENDENT_JUDGES: readonly (readonly [keyof ProviderCredentials, ModelRef])[] = [
  ['LLM_MISTRAL_API_KEY', { provider: 'mistral', model: 'mistral-large-latest' }],
  ['LLM_GOOGLE_API_KEY', { provider: 'google', model: 'gemini-3.8-flash' }],
];

/**
 * The evals' configuration: the judge moves to the first provider other than the voice's that has a key.
 * `isIndependent` is false when only the voice's provider has one: the scores are then read with that bias.
 */
export function evalsConfig(
  config: LlmConfig,
  credentials: ProviderCredentials,
): { readonly config: LlmConfig; readonly isIndependent: boolean } {
  const voice = config.roles.voice.provider;
  const judge = INDEPENDENT_JUDGES.find(
    ([key, ref]) => ref.provider !== voice && credentials[key] !== undefined && credentials[key] !== '',
  );
  if (judge === undefined) return { config, isIndependent: config.roles.judge.provider !== voice };
  const [, ref] = judge;
  return {
    config: { ...config, roles: { ...config.roles, judge: { ...config.roles.judge, ...ref } } },
    isIndependent: true,
  };
}
