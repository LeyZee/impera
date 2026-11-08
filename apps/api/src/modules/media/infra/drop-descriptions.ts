import type { Database } from '@impera/db';
import type { LlmGateway } from '@impera/llm';

import { createDropDescriber, type DropContext, type FileMediaTools } from '../application/describe-drop';

import { createDrizzleDropDescriptionStore } from './drop-description-store';
import { createFfmpegFileTools } from './ffmpeg-media-tools';
import { createGatewayDropSenser, createGatewayTranscriber } from './gateway-senser';

/** A media she dropped, on the worker's disk, with what the drop says of it. */
interface DroppedMedia {
  readonly creatorId: string;
  readonly mediaAssetId: string;
  readonly path: string;
  readonly mime: string;
  readonly kind: 'image' | 'video';
  readonly bytes: number;
  readonly context: DropContext;
}

/** The description of her dropped media (ADR 0083), for the drops' job. */
export interface DropDescriptions {
  /** Whether the vision AI already described this medium for a drop. */
  described(mediaAssetId: string): Promise<boolean>;
  /** Described and kept with its review reasons, or why not; a file that does not open is logged by the caller. */
  describe(media: DroppedMedia): Promise<'described' | 'budget' | 'failed' | 'unreadable'>;
}

export function createDropDescriptions(deps: {
  readonly adminDb: Database;
  readonly gateway: Pick<LlmGateway, 'describeDrop' | 'transcribe'>;
  /** Tests only: other tools than ffmpeg's. */
  readonly tools?: FileMediaTools;
}): DropDescriptions {
  const store = createDrizzleDropDescriptionStore(deps.adminDb);
  const describer = createDropDescriber({
    sense: createGatewayDropSenser(deps.gateway),
    transcribe: createGatewayTranscriber(deps.gateway),
    tools: deps.tools ?? createFfmpegFileTools(),
  });
  return {
    described: (mediaAssetId) => store.described(mediaAssetId),
    describe: async (media) => {
      const result = await describer.describe(media);
      if (!result.ok) return result.error.code;
      await store.save(media.creatorId, media.mediaAssetId, result.value);
      return 'described';
    },
  };
}
