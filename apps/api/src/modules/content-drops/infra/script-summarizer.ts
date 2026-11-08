import type { LlmGateway } from '@impera/llm';

import type { ScriptSummarizer } from '../domain/ports';

/** The brain of the gateway tells her script (ADR 0083 § 6, prompt `brain/script-summary`), under the daily cap. */
export function createGatewayScriptSummarizer(
  gateway: Pick<LlmGateway, 'summarizeScript'>,
): ScriptSummarizer {
  return {
    summarize: async ({ creatorId, ...input }) => {
      const result = await gateway.summarizeScript({ ...input, trace: { creatorId } });
      if (result.ok)
        return {
          kind: 'summarized',
          summary: result.value.output,
          model: result.value.meta.model,
          promptHash: result.value.meta.promptHash,
        };
      return result.error.code === 'all_models_failed' ? { kind: 'failed' } : { kind: 'budget' };
    },
  };
}
