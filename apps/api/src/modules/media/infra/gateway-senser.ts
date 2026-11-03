import { err, ok, type MediaDescription } from '@impera/contracts';
import type { LlmGateway } from '@impera/llm';

import type { MediaDescriptionStore, Senser, Transcriber } from '../application/describe-media';

/** The gateway's `sense` role behind this module's port. */
export function createGatewaySenser(gateway: Pick<LlmGateway, 'sense'>): Senser {
  return async (request) => {
    const result = await gateway.sense({
      origin: request.origin,
      media:
        request.kind === 'image'
          ? { kind: 'image', mediaType: request.mediaType, data: request.data }
          : {
              kind: 'video',
              durationS: request.durationS,
              mediaType: request.mediaType,
              data: request.data,
              keyframes: request.keyframes,
            },
    });
    if (result.ok) return ok({ description: result.value.output, isFallback: result.value.meta.isFallback });
    return err(result.error.attempts.map((a) => `${a.model}: ${a.outcome}`).join(', '));
  };
}

export function createGatewayTranscriber(gateway: Pick<LlmGateway, 'transcribe'>): Transcriber {
  return async (audio, durationS) => {
    const result = await gateway.transcribe({
      data: audio,
      mediaType: 'audio/mpeg',
      ...(durationS !== undefined && { durationS }),
    });
    if (result.ok) return ok(result.value.text);
    return err(result.error.attempts.map((a) => `${a.model}: ${a.outcome}`).join(', '));
  };
}

export function createInMemoryDescriptionStore(): MediaDescriptionStore {
  const descriptions = new Map<string, MediaDescription>();
  return {
    find: (key) => Promise.resolve(descriptions.get(key)),
    save: (key, description) => {
      descriptions.set(key, description);
      return Promise.resolve();
    },
  };
}
