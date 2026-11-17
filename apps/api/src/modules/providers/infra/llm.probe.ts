import type { AiProvider } from '@impera/contracts';

import { probeOutcomeOf, type ProbeResult, type ProviderProbe } from '../domain/probe';

/**
 * The gateway's test of a provider (`LlmGateway.testConnection`, packages/llm), as the composition root hands it: one
 * tiny generation on the model the agent uses, journaled under `probe` and stopped by the day's cap.
 */
export type GatewayTest = (provider: LlmProbeProvider) => Promise<{
  readonly outcome: string;
  readonly latencyMs?: number;
  readonly modelLabel?: string;
}>;

export type LlmProbeProvider = Extract<AiProvider, 'xai' | 'mistral' | 'google'>;

/** The gateway holds the key in use: the one this module hands it (`apiKeySource`), so `key` is not passed on. */
export function createLlmProbe(provider: LlmProbeProvider, test: GatewayTest): ProviderProbe {
  return {
    provider,
    async probe(): Promise<ProbeResult> {
      try {
        const result = await test(provider);
        return {
          outcome: probeOutcomeOf(result.outcome),
          latencyMs: result.latencyMs ?? null,
          model: result.modelLabel ?? null,
        };
      } catch {
        return { outcome: 'not_answering', latencyMs: null, model: null };
      }
    },
  };
}
