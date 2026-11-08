import type { Database } from '@impera/db';
import type { LlmGateway } from '@impera/llm';

import { createDropDescriber, type DropContext, type FileMediaTools } from '../application/describe-drop';

import { createDrizzleDropDescriptionStore, type DetailedDescription } from './drop-description-store';
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
  /** The version of the prompt a description is written with now: a medium described with another is described again. */
  readonly promptHash: string;
  /** Whether this medium needs no new description: a human's, or the vision AI's with the prompt of now. */
  described(mediaAssetId: string): Promise<boolean>;
  /** The latest detailed description of each of these media that has one, by medium (ADR 0083 § 2). */
  detailed(mediaAssetIds: readonly string[]): Promise<ReadonlyMap<string, DetailedDescription>>;
  /** Described and kept with its review reasons, or why not; a file that does not open is logged by the caller. */
  describe(media: DroppedMedia): Promise<'described' | 'budget' | 'failed' | 'unreadable'>;
}

export function createDropDescriptions(deps: {
  readonly adminDb: Database;
  readonly gateway: Pick<LlmGateway, 'describeDrop' | 'transcribe' | 'promptHashes'>;
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
    promptHash: deps.gateway.promptHashes.creatorDrop,
    described: (mediaAssetId) => store.described(mediaAssetId, deps.gateway.promptHashes.creatorDrop),
    detailed: (mediaAssetIds) => store.detailed(mediaAssetIds),
    describe: async (media) => {
      const result = await describer.describe(media);
      if (!result.ok) return result.error.code;
      await store.save(media.creatorId, media.mediaAssetId, result.value);
      return 'described';
    },
  };
}
