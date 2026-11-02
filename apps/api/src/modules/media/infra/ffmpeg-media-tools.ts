import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod';

import type { ExtractedFrame, MediaTools } from '../application/describe-media';

const execFileAsync = promisify(execFile);

type MediaBinary = 'ffmpeg' | 'ffprobe';
const BINARIES: Record<MediaBinary, string> = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };

/** Said instead of `spawn ENOENT`, which tells nobody what to install. */
const missingMessage = (binary: string): string =>
  `${binary} absent : introuvable sur le PATH. Installe ffmpeg (il fournit aussi ffprobe), puis relance.`;

const isNotFound = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

/**
 * What ffmpeg may open (audit de sécurité du 02/11, M4). A fan's file is read by its content, never by a name we
 * chose: only the containers a phone sends are let in, never a playlist (HLS), a list of other files (concat) nor a
 * device, and nothing but the file itself is opened, never a URL nor another local path it would name.
 */
const INPUT_FORMATS = [
  'mov',
  'matroska',
  'jpeg_pipe',
  'png_pipe',
  'webp_pipe',
  'gif',
  'mp3',
  'ogg',
  'wav',
  'aac',
] as const;
const INPUT_LIMITS = ['-format_whitelist', INPUT_FORMATS.join(','), '-protocol_whitelist', 'file'] as const;

/**
 * The longest each call may run before it is killed: a crafted file (a decompression bomb, a stream without end)
 * must free its worker slot, never hold it. Generous for a phone's video; the job's retry decides what comes next.
 */
const TIMEOUTS_MS = { probe: 15_000, keyframes: 120_000, audioTrack: 60_000, toJpeg: 30_000 } as const;

async function run(
  binary: string,
  args: readonly string[],
  options: { readonly maxBuffer?: number; readonly timeout?: number } = {},
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  try {
    // SIGKILL: a decoder stuck in a loop may not answer SIGTERM.
    return await execFileAsync(binary, args, { ...options, killSignal: 'SIGKILL' });
  } catch (error) {
    if (isNotFound(error)) throw new Error(missingMessage(binary), { cause: error });
    throw error;
  }
}

/**
 * The media binaries that cannot be run here, empty when both answer: read once at start-up, so that a missing
 * ffmpeg is said in the log rather than found on the first video of a fan.
 */
export async function missingMediaBinaries(binaries = BINARIES): Promise<readonly MediaBinary[]> {
  const names: readonly MediaBinary[] = ['ffmpeg', 'ffprobe'];
  const answers = await Promise.all(
    names.map((name) =>
      execFileAsync(binaries[name], ['-version'], { timeout: 5_000 }).then(
        () => true,
        () => false,
      ),
    ),
  );
  return names.filter((_, i) => answers[i] !== true);
}

/** Enough for a vision model, far cheaper in tokens than a full-size image. */
const MAX_SIDE = 1_024;
const SCALE = `scale='min(${String(MAX_SIDE)},iw)':-2`;
const FFMPEG_BUFFER = 32 * 1024 * 1024;

const ProbeSchema = z.object({
  format: z.object({ duration: z.coerce.number() }),
  streams: z.array(z.object({ codec_type: z.string().optional() })).default([]),
});

async function inTempDir<T>(input: Uint8Array, use: (dir: string, path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nirvana-media-'));
  try {
    const path = join(dir, 'input');
    await writeFile(path, input);
    return await use(dir, path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** ffmpeg and ffprobe come with the Docker image (operations.md); files never leave a private temp folder. */
export function createFfmpegMediaTools(
  binaries = BINARIES,
  timeouts: Readonly<Record<keyof typeof TIMEOUTS_MS, number>> = TIMEOUTS_MS,
): MediaTools {
  const ffmpeg = (args: readonly string[], timeout: number) =>
    run(binaries.ffmpeg, ['-v', 'error', '-y', ...INPUT_LIMITS, ...args], {
      maxBuffer: FFMPEG_BUFFER,
      timeout,
    });

  return {
    probe: (video) =>
      inTempDir(video, async (_, path) => {
        const { stdout } = await run(
          binaries.ffprobe,
          [
            '-v',
            'error',
            ...INPUT_LIMITS,
            '-show_entries',
            'format=duration:stream=codec_type',
            '-of',
            'json',
            path,
          ],
          { timeout: timeouts.probe },
        );
        const info = ProbeSchema.parse(JSON.parse(stdout));
        if (!Number.isFinite(info.format.duration)) throw new Error('ffprobe gave no duration');
        return {
          durationS: info.format.duration,
          hasAudio: info.streams.some((s) => s.codec_type === 'audio'),
        };
      }),

    keyframes: (video, perSecond) =>
      inTempDir(video, async (dir, path) => {
        // A few frames a second at most, near-duplicates dropped (mpdecimate); showinfo prints each kept
        // frame's time. A long video is sampled sparser rather than decoded in full and thinned afterwards.
        const { stderr } = await run(
          binaries.ffmpeg,
          [
            '-hide_banner',
            '-y',
            ...INPUT_LIMITS,
            '-i',
            path,
            '-vf',
            `fps=${String(perSecond)},mpdecimate,${SCALE},showinfo`,
            '-fps_mode',
            'vfr',
            '-q:v',
            '4',
            join(dir, 'frame-%04d.jpg'),
          ],
          { maxBuffer: FFMPEG_BUFFER, timeout: timeouts.keyframes },
        );
        const times = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number.parseFloat(m[1] ?? '0'));
        const files = (await readdir(dir)).filter((f) => f.startsWith('frame-')).sort();
        const frames: ExtractedFrame[] = [];
        for (const [index, file] of files.entries()) {
          frames.push({
            atS: Math.round(times[index] ?? index),
            mediaType: 'image/jpeg',
            data: new Uint8Array(await readFile(join(dir, file))),
          });
        }
        return frames;
      }),

    audioTrack: (video) =>
      inTempDir(video, async (dir, path) => {
        const out = join(dir, 'audio.mp3');
        await ffmpeg(
          ['-i', path, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', out],
          timeouts.audioTrack,
        );
        return new Uint8Array(await readFile(out));
      }),

    toJpeg: (image) =>
      inTempDir(image, async (dir, path) => {
        const out = join(dir, 'image.jpg');
        await ffmpeg(['-i', path, '-vf', SCALE, '-frames:v', '1', '-q:v', '3', out], timeouts.toJpeg);
        return new Uint8Array(await readFile(out));
      }),
  };
}
