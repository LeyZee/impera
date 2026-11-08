import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import type { DropStorage, MediaToThumbnail, ScratchRoom, ThumbnailQueue } from '../../domain/ports';
import { makeThumbnail, thumbnailKeyOf } from '../thumbnail';

const NOW = new Date('2026-11-08T22:00:00.000Z');

describe('content-drops › content_drops.make_thumbnail (SC-04 lot c4)', () => {
  function fakes(target: MediaToThumbnail | null, picture: 'made' | 'none' = 'made', room = true) {
    const log: string[] = [];
    const storage: Pick<DropStorage, 'download' | 'upload'> = {
      download: async (key, path) => {
        log.push(`download ${key}`);
        await writeFile(path, 'invented bytes');
        return true;
      },
      upload: (key, _path, mime) => {
        log.push(`upload ${key} ${mime}`);
        return Promise.resolve();
      },
    };
    const queue: Pick<ThumbnailQueue, 'target' | 'settle' | 'later'> = {
      target: () => Promise.resolve(target),
      settle: (id, key) => {
        log.push(`settle ${id} ${key ?? 'none'}`);
        return Promise.resolve();
      },
      later: (_creatorId, id, _correlationId, runAt) => {
        log.push(`later ${id} ${runAt.toISOString()}`);
        return Promise.resolve();
      },
    };
    const scratch: ScratchRoom = { take: () => Promise.resolve(room ? () => undefined : null) };
    const deps = {
      storage,
      queue,
      thumbnailer: {
        make: async (_path: string, _kind: 'image' | 'video', out: string) => {
          if (picture === 'none') return false;
          await writeFile(out, 'jpeg');
          return true;
        },
      },
      scratchDir: tmpdir(),
      room: scratch,
    };
    return { deps, log };
  }

  const photo: MediaToThumbnail = {
    creatorId: 'creator',
    kind: 'image',
    bytes: 14,
    storageKey: 'media/creator/abc',
    sha256: 'abc',
    erased: false,
    tried: false,
  };

  it('writes the picture under its fingerprint, then marks the medium', async () => {
    const { deps, log } = fakes(photo);
    expect(await makeThumbnail(deps, 'media-1', NOW, 'test')).toBe('made');
    expect(log).toEqual([
      'download media/creator/abc',
      `upload ${thumbnailKeyOf('creator', 'abc')} image/jpeg`,
      'settle media-1 thumbnails/creator/abc.jpg',
    ]);
  });

  it('marks a file ffmpeg cannot read as tried, without a picture', async () => {
    const { deps, log } = fakes(photo, 'none');
    expect(await makeThumbnail(deps, 'media-1', NOW, 'test')).toBe('none');
    expect(log).toEqual(['download media/creator/abc', 'settle media-1 none']);
  });

  it('leaves alone a voice note, a medium tried already, or one whose original is gone', async () => {
    for (const [target, outcome] of [
      [{ ...photo, kind: 'audio' }, 'not_pictured'],
      [{ ...photo, tried: true }, 'already'],
      [{ ...photo, erased: true }, 'gone'],
      [null, 'gone'],
    ] as const) {
      const { deps, log } = fakes(target);
      expect(await makeThumbnail(deps, 'media-1', NOW, 'test')).toBe(outcome);
      expect(log).toEqual([]);
    }
  });

  it('comes back later when the disk is short', async () => {
    const { deps, log } = fakes(photo, 'made', false);
    expect(await makeThumbnail(deps, 'media-1', NOW, 'test')).toBe('later');
    expect(log).toEqual(['later media-1 2026-11-08T22:15:00.000Z']);
  });
});
