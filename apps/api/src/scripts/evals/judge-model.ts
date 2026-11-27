import { MISTRAL_FALLBACK_MODEL, type LlmConfig, type ModelRef, type ProviderCredentials } from '@impera/llm';

/** A run of the evals never spends more than this, on top of and apart from the agent's daily cap. */
export const EVALS_CAP_EUR = 6;

/**
 * The judge's timeout in the evals: it scores nine criteria on a whole conversation and took 37 to 48 s on 11/11,
 * against 60 s (OPS-07). Mistral Large 4 thinks before it answers, and its thinking cannot be turned down through
 * our SDK (only `high` or `none`, which Mistral refuses): 180 s leaves it room. The evals only: the production roles
 * keep their own.
 */
export const EVALS_JUDGE_TIMEOUT_MS = 180_000;

/**
 * The judge's room to answer in the evals: nine criteria, each with its reason, do not fit in the 600 tokens of the
 * production role, and a cut answer is no score (Mistral « no output », Gemini « truncated », 4 calls out of 4 on the
 * PC, 20/11). Mistral Large 4 counts its thinking in this room: 3 600 to 4 600 tokens of it on a short conversation
 * (PC, 21/11), so 2 000 left it no room to write the scores at all. The evals only.
 */
export const EVALS_JUDGE_MAX_OUTPUT_TOKENS = 8_000;

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
      judge: {
        ...config.roles.judge,
        ...ref,
        timeoutMs: EVALS_JUDGE_TIMEOUT_MS,
        maxOutputTokens: EVALS_JUDGE_MAX_OUTPUT_TOKENS,
      },
    },
  });
  if (judge === undefined)
    return { config: withJudge(), isIndependent: config.roles.judge.provider !== voice };
  const [, ref] = judge;
  return { config: withJudge(ref), isIndependent: true };
}
