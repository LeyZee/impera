import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';

import type { Thumbnailer } from '../../domain/ports';

const execFileAsync = promisify(execFile);

/**
 * What ffmpeg may open for a picture (audit de sécurité du 02/11, M4): the cleaned file only, in the containers a
 * cleaned medium has (ADR 0070 § 2, a photo's own format), never a playlist, a list of files, a device nor a URL.
 */
const INPUT_LIMITS = [
  '-format_whitelist',
  'mov,matroska,avi,jpeg_pipe,png_pipe,webp_pipe',
  '-protocol_whitelist',
  'file',
] as const;

/** Wide enough for a screen's tile and its view in large, small enough to stay a reduced copy (ADR 0030 § 4). */
const MAX_SIDE = 640;
const SCALE = `scale='min(${String(MAX_SIDE)},iw)':-2`;
/** A frame of the first seconds that says the video, rather than its first, often black. */
const VIDEO_FILTER = `thumbnail=60,${SCALE}`;
/** A crafted file must free its worker slot: the job's retry decides what comes next. */
const TIMEOUT_MS = 60_000;

const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';
const isKilled = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'killed' in error && error.killed === true;

/**
 * The reduced JPEG of a cleaned photo or video (SC-04 lot c4): its rotation applied, its metadata left out
 * (`-map_metadata -1`), one frame. A missing ffmpeg, or one killed by its time limit, throws and the job retries; a
 * file it cannot read gives none.
 */
export function createThumbnailer(ffmpeg = 'ffmpeg'): Thumbnailer {
  return {
    async make(path, kind, out) {
      try {
        await execFileAsync(
          ffmpeg,
          [
            '-v',
            'error',
            '-y',
            ...INPUT_LIMITS,
            '-i',
            path,
            '-map_metadata',
            '-1',
            '-vf',
            kind === 'video' ? VIDEO_FILTER : SCALE,
            '-frames:v',
            '1',
            '-q:v',
            '5',
            '-f',
            'image2',
            '-c:v',
            'mjpeg',
            out,
          ],
          { timeout: TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 },
        );
      } catch (error) {
        if (isMissing(error) || isKilled(error)) throw error;
        return false;
      }
      const made = await stat(out).catch(() => null);
      return made !== null && made.size > 0;
    },
  };
}
