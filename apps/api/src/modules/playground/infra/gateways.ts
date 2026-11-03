import {
  createLlmGateway,
  createModelResolver,
  createTranscriberResolver,
  DEFAULT_LLM_CONFIG,
  MODELS,
  type LlmGateway,
  type LlmGatewayDeps,
} from '@impera/llm';

/** What the playground gateways share: keys, the call journal (so the daily cap counts them all), listeners. */
export type PlaygroundGatewayDeps = Pick<
  LlmGatewayDeps,
  'credentials' | 'log' | 'onKeyRefused' | 'onBudget' | 'dailyCapEur'
>;

export function createPlaygroundGateway(deps: PlaygroundGatewayDeps): LlmGateway {
  return createLlmGateway({
    ...deps,
    config: DEFAULT_LLM_CONFIG,
    resolveModel: createModelResolver(deps.credentials),
    resolveTranscriber: createTranscriberResolver(deps.credentials),
  });
}

/** The same config with another voice model, for a side-by-side comparison; undefined for an unknown model. */
export function createVoiceVariant(deps: PlaygroundGatewayDeps, model: string): LlmGateway | undefined {
  const info = MODELS.find((m) => m.model === model);
  if (info === undefined) return undefined;
  const { voice } = DEFAULT_LLM_CONFIG.roles;
  return createLlmGateway({
    ...deps,
    config: {
      ...DEFAULT_LLM_CONFIG,
      roles: {
        ...DEFAULT_LLM_CONFIG.roles,
        voice: {
          provider: info.provider,
          model: info.model,
          temperature: voice.temperature,
          maxOutputTokens: voice.maxOutputTokens,
          timeoutMs: voice.timeoutMs,
        },
      },
    },
    resolveModel: createModelResolver(deps.credentials),
  });
}
