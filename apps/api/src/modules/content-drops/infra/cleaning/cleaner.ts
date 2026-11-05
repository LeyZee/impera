import { readFile, writeFile } from 'node:fs/promises';

import { UnreadableFile } from '../../domain/errors';
import type { FileCleaner } from '../../domain/ports';
import type { FileFamily } from '../../domain/sniff';

import { cleanAv, probeAv } from './av';
import { cleanHeif, cleanJpeg, cleanPng, cleanWebp, type CleanedStill } from './stills';

const STILLS: Partial<Record<FileFamily, (bytes: Uint8Array) => CleanedStill>> = {
  jpeg: cleanJpeg,
  png: cleanPng,
  webp: cleanWebp,
  heif: cleanHeif,
};

/**
 * A photo is cleaned byte by byte (`stills.ts`, 30 Mo at most, read whole); a video or a vocal by ffmpeg, its streams
 * copied, then read again by ffprobe: the size and the length that count are those of the cleaned file.
 */
export function createFileCleaner(binaries = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }): FileCleaner {
  return {
    async clean(raw, out, family, mime) {
      const still = STILLS[family];
      if (still !== undefined) {
        const cleaned = still(new Uint8Array(await readFile(raw)));
        await writeFile(out, cleaned.bytes);
        return {
          width: cleaned.width,
          height: cleaned.height,
          durationMs: null,
          hasVideo: false,
          hasAudio: false,
        };
      }
      const video = mime.startsWith('video/');
      try {
        await cleanAv(raw, out, { family, quicktime: mime === 'video/quicktime', video }, binaries.ffmpeg);
        return await probeAv(out, binaries.ffprobe);
      } catch (error) {
        // A missing ffmpeg, or one killed by its timeout on a loaded machine: the job retries, nothing is refused.
        const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
        const killed =
          typeof error === 'object' && error !== null && 'killed' in error && error.killed === true;
        if (missing || killed) throw error;
        throw new UnreadableFile(`ffmpeg could not read the file`, { cause: error });
      }
    },
  };
}
