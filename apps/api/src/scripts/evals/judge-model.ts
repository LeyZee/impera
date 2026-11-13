import { MISTRAL_FALLBACK_MODEL, type LlmConfig, type ModelRef, type ProviderCredentials } from '@impera/llm';

/** A run of the evals never spends more than this, on top of and apart from the agent's daily cap. */
export const EVALS_CAP_EUR = 3;

/**
 * The judge's timeout in the evals: it scores nine criteria on a whole conversation and took 37 to 48 s on 11/11,
 * against 60 s (OPS-07). The evals only: the production roles keep their own.
 */
export const EVALS_JUDGE_TIMEOUT_MS = 90_000;

// Another family than the voice's: a model scoring its own words is too kind to them.
const INDEPENDENT_JUDGES: readonly (readonly [keyof ProviderCredentials, ModelRef])[] = [
  ['LLM_MISTRAL_API_KEY', { provider: 'mistral', model: MISTRAL_FALLBACK_MODEL }],
  ['LLM_GOOGLE_API_KEY', { provider: 'google', model: 'gemini-3.8-flash' }],
];

/**
 * The evals' configuration: the judge moves to the first provider other than the voice's that has a key, and waits
 * `EVALS_JUDGE_TIMEOUT_MS`.
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
  const withJudge = (ref?: ModelRef): LlmConfig => ({
    ...config,
    roles: {
      ...config.roles,
      judge: { ...config.roles.judge, ...ref, timeoutMs: EVALS_JUDGE_TIMEOUT_MS },
    },
  });
  if (judge === undefined)
    return { config: withJudge(), isIndependent: config.roles.judge.provider !== voice };
  const [, ref] = judge;
  return { config: withJudge(ref), isIndependent: true };
}
