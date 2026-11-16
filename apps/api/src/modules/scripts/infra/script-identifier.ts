import type { LlmGateway } from '@impera/llm';

import type { ScriptIdentifier } from '../domain/ports';

/**
 * The brain of the gateway writes a native script's identity (SC-04 lot c8, prompt `brain/script-identity`), under the
 * daily cap. A voice note goes with its kind and no description: the vision never hears one (ADR 0083 § 2).
 */
export function createGatewayScriptIdentifier(
  gateway: Pick<LlmGateway, 'identifyScript' | 'promptHashes'>,
): ScriptIdentifier {
  return {
    promptHash: gateway.promptHashes.scriptIdentity,
    identify: async ({ creatorId, scriptName, steps }) => {
      const result = await gateway.identifyScript({
        scriptName,
        steps: steps.map((step) => ({
          name: step.name,
          text: step.text,
          media: step.media.map((media) => ({
            kind: media.kind,
            durationS: null,
            description: media.description,
          })),
        })),
        trace: { creatorId },
      });
      if (result.ok)
        return {
          kind: 'identified',
          content: result.value.output,
          model: result.value.meta.model,
          promptHash: result.value.meta.promptHash,
        };
      return result.error.code === 'all_models_failed' ? { kind: 'failed' } : { kind: 'budget' };
    },
  };
}
