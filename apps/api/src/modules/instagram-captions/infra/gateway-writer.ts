import type { LlmGateway } from '@impera/llm';

import type { CaptionWriter } from '../domain/ports';

/** The voice of the gateway writes her captions (ADR 0164 § 9, prompt `voice/instagram-caption`), under the daily cap. */
export function createGatewayCaptionWriter(gateway: Pick<LlmGateway, 'proposeCaptions'>): CaptionWriter {
  return {
    write: async ({ creatorId, ...request }) => {
      const result = await gateway.proposeCaptions({ ...request, trace: { creatorId } });
      if (result.ok) return result.value.output.captions;
      return result.error.code === 'all_models_failed' ? 'failed' : 'budget';
    },
  };
}
