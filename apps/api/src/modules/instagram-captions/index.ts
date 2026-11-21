/** Public entry point of the `instagram-captions` module (INS-05 lot b, ADR 0164 § 9). Other modules import this file only. */
import type { Database } from '@impera/db';
import type { LlmGateway } from '@impera/llm';

import { proposeCaptions, type ProposeOutcome } from './application/propose';
import type { CaptionAsking, CaptionPersona, DescribedReel } from './domain/ports';
import { enqueueCaptions } from './infra/db/queue';
import { createGatewayCaptionWriter } from './infra/gateway-writer';

/** The day's AI budget spent: asked again each hour, so it resumes once the day turns. */
const BUDGET_DELAY_MS = 60 * 60_000;

export interface InstagramCaptionsDeps {
  /** Application role: the job's queue, in her creator. */
  readonly db: Database;
  readonly gateway: Pick<LlmGateway, 'proposeCaptions'>;
  /** `content-drops`: the live drops that hold a medium, described. */
  readonly drops: (creatorId: string, mediaAssetId: string) => Promise<readonly DescribedReel[]>;
  /** Her active persona for a public text; `null` without one. */
  readonly persona: (creatorId: string) => Promise<CaptionPersona | null>;
  /** Her past captions that did well; empty until her account is read. */
  readonly examples: (creatorId: string) => Promise<readonly string[]>;
  /** The door of `creator-decisions`. */
  readonly asking: CaptionAsking;
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export interface InstagramCaptionsModule {
  readonly name: 'instagram-captions';
  /** A medium of hers was described: its captions are asked for, once per medium waiting. Replayable. */
  described(creatorId: string, mediaAssetId: string, correlationId: string): Promise<void>;
  readonly jobs: {
    /** `instagram_captions.propose`: what happened, for the log. */
    propose(creatorId: string, mediaAssetId: string, correlationId: string): Promise<ProposeOutcome>;
  };
}

export function createInstagramCaptionsModule(deps: InstagramCaptionsDeps): InstagramCaptionsModule {
  const clock = deps.clock ?? (() => new Date());
  const writer = createGatewayCaptionWriter(deps.gateway);
  return {
    name: 'instagram-captions',
    described: (creatorId, mediaAssetId, correlationId) =>
      enqueueCaptions(deps.db, { creatorId, mediaAssetId, correlationId }, null),
    jobs: {
      propose: async (creatorId, mediaAssetId, correlationId) => {
        const now = clock();
        const outcome = await proposeCaptions(
          { drops: deps.drops, persona: deps.persona, examples: deps.examples, writer, asking: deps.asking },
          creatorId,
          mediaAssetId,
          now,
        );
        if (outcome === 'budget')
          await enqueueCaptions(
            deps.db,
            { creatorId, mediaAssetId, correlationId },
            new Date(now.getTime() + BUDGET_DELAY_MS),
          );
        return outcome;
      },
    },
  };
}
