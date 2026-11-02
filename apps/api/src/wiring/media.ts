import {
  createDrizzleDescriptionReader,
  createMediaModule,
  missingMediaBinaries,
  type MediaModule,
} from '../modules/media';

import type { Shared } from './shared';

export interface WiredMedia {
  readonly module: MediaModule;
  readonly descriptions: ReturnType<typeof createDrizzleDescriptionReader>;
}

export async function wireMedia(shared: Shared): Promise<WiredMedia> {
  // A fan's video needs ffmpeg and ffprobe: said at start-up, not on the first video.
  const missing = await missingMediaBinaries();
  if (missing.length > 0) {
    shared.logger.warn({ missing }, 'ffmpeg missing: fan videos and voice notes cannot be read');
  }
  return { module: createMediaModule(), descriptions: createDrizzleDescriptionReader(shared.db) };
}
