import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { DropStorage, ScratchRoom, Thumbnailer, ThumbnailQueue } from '../domain/ports';

export interface ThumbnailDeps {
  readonly storage: Pick<DropStorage, 'download' | 'upload'>;
  readonly queue: Pick<ThumbnailQueue, 'target' | 'settle' | 'later'>;
  readonly thumbnailer: Thumbnailer;
  readonly scratchDir: string;
  readonly room: ScratchRoom;
}

/** A machine short of disk takes the medium again this much later (ADR 0070 § 4). */
const SHORT_OF_DISK_DELAY_MS = 15 * 60_000;

export type ThumbnailOutcome = 'made' | 'none' | 'already' | 'gone' | 'not_pictured' | 'later';

/** Where a medium's reduced picture lives: beside her media, named by its fingerprint, so that a replay writes it again. */
export const thumbnailKeyOf = (creatorId: string, sha256: string): string =>
  `thumbnails/${creatorId}/${sha256}.jpg`;

/**
 * `content_drops.make_thumbnail` (ADR 0030 § 4, SC-04 lot c4): a photo or a video of her library gets a reduced JPEG
 * for the agency's screen, kept after its original is erased. Nothing for a voice note, a medium already tried or one
 * whose original is gone. Tried once: a file ffmpeg cannot read keeps no picture, and the screen shows its tile.
 * Replayable: the picture is written under its fingerprint, then the medium is marked.
 */
export async function makeThumbnail(
  deps: ThumbnailDeps,
  mediaAssetId: string,
  now: Date,
  correlationId: string,
): Promise<ThumbnailOutcome> {
  const target = await deps.queue.target(mediaAssetId);
  if (target === null || target.erased) return 'gone';
  if (target.kind === 'audio') return 'not_pictured';
  if (target.tried) return 'already';
  const release = await deps.room.take(target.bytes);
  if (release === null) {
    await deps.queue.later(
      target.creatorId,
      mediaAssetId,
      correlationId,
      new Date(now.getTime() + SHORT_OF_DISK_DELAY_MS),
    );
    return 'later';
  }
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(deps.scratchDir, 'impera-thumbnail-'));
    const path = join(dir, 'media');
    const out = join(dir, 'thumbnail.jpg');
    if (!(await deps.storage.download(target.storageKey, path, target.bytes))) return 'gone';
    if (!(await deps.thumbnailer.make(path, target.kind, out))) {
      await deps.queue.settle(mediaAssetId, null, now);
      return 'none';
    }
    const key = thumbnailKeyOf(target.creatorId, target.sha256);
    const sha256 = createHash('sha256')
      .update(await readFile(out))
      .digest('hex');
    await deps.storage.upload(key, out, 'image/jpeg', sha256);
    await deps.queue.settle(mediaAssetId, key, now);
    return 'made';
  } finally {
    if (dir !== null) await rm(dir, { recursive: true, force: true });
    release();
  }
}
