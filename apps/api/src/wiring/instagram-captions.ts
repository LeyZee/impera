import { JOB_PAYLOADS, type StoredPersona } from '@impera/contracts';
import type { LlmGateway } from '@impera/llm';

import { defineTask } from '../jobs';
import { captionWriterPersona } from '../modules/agent';
import type { ContentDropsModule } from '../modules/content-drops';
import type { CreatorDecisionsModule } from '../modules/creator-decisions';
import { createInstagramCaptionsModule, type InstagramCaptionsModule } from '../modules/instagram-captions';

import type { Shared, TasksNamed } from './shared';

export interface WiredInstagramCaptions {
  readonly module: InstagramCaptionsModule;
  readonly tasks: TasksNamed<'instagram_captions.propose'>;
}

/** Her active persona version as the `persona` module stores it (`versions.active`), matched by shape. */
type ActiveVersion = (creatorId: string) => Promise<{
  readonly id: string;
  readonly version: string;
  readonly creatorName: string;
  readonly persona: StoredPersona;
} | null>;

/**
 * The captions proposed for a Reel she dropped (INS-05 lot b, ADR 0164 § 9): written by the voice from what
 * `content-drops` says of the video, in her active persona's public voice (`agent`), asked to her through the door of
 * `creator-decisions`. Her past captions are not read yet: the examples stay empty until her account is.
 */
export function wireInstagramCaptions(
  shared: Shared,
  deps: {
    readonly gateway: Pick<LlmGateway, 'proposeCaptions'>;
    readonly contentDrops: Pick<ContentDropsModule, 'describedDrops' | 'describedDrop'>;
    readonly activePersona: ActiveVersion;
    readonly asking: CreatorDecisionsModule['asking'];
    readonly clock?: () => Date;
  },
): WiredInstagramCaptions {
  const module = createInstagramCaptionsModule({
    db: shared.db,
    gateway: deps.gateway,
    drops: (creatorId, mediaAssetId) => deps.contentDrops.describedDrops(creatorId, mediaAssetId),
    reel: (creatorId, dropId) => deps.contentDrops.describedDrop(creatorId, dropId),
    persona: async (creatorId) => {
      const stored = await deps.activePersona(creatorId);
      if (stored === null) return null;
      const persona = captionWriterPersona(stored, new Date());
      return {
        creatorName: persona.creatorName,
        personaSheet: persona.personaSheet,
        blocking: (text) =>
          persona
            .check([text])
            .filter((violation) => violation.blocking)
            .map((violation) => violation.code),
      };
    },
    examples: () => Promise.resolve([]),
    asking: {
      ask: (creatorId, decision) => deps.asking.ask(creatorId, decision),
      asked: async (creatorId, subject, now) =>
        (await deps.asking.read(creatorId, 'caption', subject, now)) !== null,
    },
    ...(deps.clock !== undefined && { clock: deps.clock }),
  });
  return {
    module,
    tasks: {
      'instagram_captions.propose': defineTask(
        'instagram_captions.propose',
        JOB_PAYLOADS['instagram_captions.propose'],
        shared.logger,
        async (payload, context) => {
          const outcome = await module.jobs.propose(
            payload.creatorId,
            payload.mediaAssetId,
            payload.correlationId,
          );
          context.logger.info(
            { mediaAssetId: payload.mediaAssetId, outcome },
            'instagram captions: captions proposed for a described medium',
          );
        },
      ),
    },
  };
}
