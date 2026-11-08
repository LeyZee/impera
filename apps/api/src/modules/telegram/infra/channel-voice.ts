import type { LlmGateway } from '@impera/llm';

import type { ChannelVoice } from '../domain/ports';

/**
 * The gateway's voice for her channel's posts (ADR 0080 § 5, prompt `voice/telegram-channel`): every call journaled
 * against her, under the daily cap; null when no model answered or the cap is spent.
 */
export function channelVoiceOf(gateway: Pick<LlmGateway, 'channelPost'>): ChannelVoice {
  return async (input) => {
    const result = await gateway.channelPost({
      kind: input.kind,
      creatorName: input.creatorName,
      personaSheet: input.personaSheet,
      examples: input.examples,
      media: input.media,
      destination: input.destination,
      advice: input.advice,
      trace: { creatorId: input.creatorId },
    });
    return result.ok ? result.value.output : null;
  };
}
