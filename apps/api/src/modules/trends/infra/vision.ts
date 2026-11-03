import type { LlmGateway } from '@impera/llm';

import type { CaptureVision } from '../domain/ports';

/** The vision on the app's one LLM gateway: a `sense` call traced `trend_watch` (`describeTrendCaptures`). */
export function createGatewayCaptureVision(
  gateway: Pick<LlmGateway, 'describeTrendCaptures'>,
): CaptureVision {
  return {
    async describe(input) {
      const result = await gateway.describeTrendCaptures({
        captures: input.captures,
        durationS: input.durationS,
        trace: { creatorId: input.creatorId },
      });
      if (result.ok) return { ok: true, description: result.value.output };
      return {
        ok: false,
        reason: result.error.code === 'all_models_failed' ? 'unavailable' : 'budget',
      };
    },
  };
}
