import { readFile, stat, writeFile } from 'node:fs/promises';

import { UnreadableFile } from '../../domain/errors';
import type { CleanedFile, FileCleaner } from '../../domain/ports';
import type { FileFamily } from '../../domain/sniff';

import { cleanAv, probeAv, videoRouteOf, type ProbedAv } from './av';
import { cleanHeif, cleanJpeg, cleanPng, cleanWebp, type CleanedStill } from './stills';

const STILLS: Partial<Record<FileFamily, (bytes: Uint8Array) => CleanedStill>> = {
  jpeg: cleanJpeg,
  png: cleanPng,
  webp: cleanWebp,
  heif: cleanHeif,
};

/**
 * ffmpeg's failures sorted: a missing ffmpeg, or one killed by its time limit on a loaded machine, is thrown as it is
 * and the job retries; anything else means the file cannot be read, and it is refused.
 */
async function reading<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    const killed = typeof error === 'object' && error !== null && 'killed' in error && error.killed === true;
    if (missing || killed) throw error;
    throw new UnreadableFile(`ffmpeg could not read the file`, { cause: error });
  }
}

const shown = (mime: CleanedFile['mime'], probed: ProbedAv): CleanedFile => ({
  mime,
  width: probed.width,
  height: probed.height,
  durationMs: probed.durationMs,
  hasVideo: probed.hasVideo,
  hasAudio: probed.hasAudio,
});

/**
 * A photo is cleaned byte by byte (`stills.ts`, 30 Mo at most, read whole); a video or a vocal by ffmpeg, then read
 * again by ffprobe: the size and the length that count are those of the cleaned file. A video is read first to know
 * its route (ADR 0070 § 3): copied, moved into an MP4, or converted into H.264.
 */
export function createFileCleaner(binaries = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }): FileCleaner {
  const probe = (path: string): Promise<ProbedAv> => probeAv(path, binaries.ffprobe);
  return {
    async needsConversion(raw, family, mime) {
      if (!mime.startsWith('video/')) return false;
      const probed = await reading(() => probe(raw));
      return videoRouteOf(family, probed.videoCodec) === 'convert';
    },

    async clean(raw, out, family, mime) {
      const still = STILLS[family];
      if (still !== undefined) {
        const cleaned = still(new Uint8Array(await readFile(raw)));
        await writeFile(out, cleaned.bytes);
        return {
          mime,
          width: cleaned.width,
          height: cleaned.height,
          durationMs: null,
          hasVideo: false,
          hasAudio: false,
        };
      }
      const bytes = (await stat(raw)).size;
      if (!mime.startsWith('video/')) {
        await reading(() => cleanAv(raw, out, { video: false, family, bytes }, binaries.ffmpeg));
        return shown(mime, await reading(() => probe(out)));
      }
      const probed = await reading(() => probe(raw));
      const route = videoRouteOf(family, probed.videoCodec);
      const quicktime = mime === 'video/quicktime';
      await reading(() =>
        cleanAv(
          raw,
          out,
          { video: true, route, quicktime, audio: probed.audio, bytes, durationMs: probed.durationMs },
          binaries.ffmpeg,
        ),
      );
      return shown(
        route === 'copy' && quicktime ? 'video/quicktime' : 'video/mp4',
        await reading(() => probe(out)),
      );
    },
  };
}
