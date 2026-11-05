import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { z } from 'zod';

import type { FileFamily } from '../../domain/sniff';

const execFileAsync = promisify(execFile);

/**
 * What ffmpeg may open, as in the `media` module (audit de sécurité du 02/11, M4): only the containers a phone sends,
 * never a playlist, a list of other files nor a device, and nothing but the file itself, never a URL.
 */
const INPUT_LIMITS = ['-format_whitelist', 'mov,mp3,aac', '-protocol_whitelist', 'file'] as const;

/** A crafted file must free its worker slot: the job's retry decides what comes next. */
const TIMEOUTS_MS = { probe: 15_000, clean: 180_000 } as const;

const ProbeSchema = z.object({
  format: z.object({ duration: z.coerce.number().optional() }).default({}),
  streams: z
    .array(
      z.object({
        codec_type: z.string().optional(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        side_data_list: z.array(z.object({ rotation: z.number().optional() })).optional(),
        tags: z.object({ rotate: z.coerce.number().optional() }).optional(),
      }),
    )
    .default([]),
});

export interface ProbedAv {
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
  /** As it shows, its rotation applied; `null` without a video stream. */
  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: number | null;
}

async function run(binary: string, args: readonly string[], timeout: number): Promise<string> {
  // SIGKILL: a decoder stuck in a loop may not answer SIGTERM.
  const { stdout } = await execFileAsync(binary, args, {
    timeout,
    killSignal: 'SIGKILL',
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

/** A video or a vocal read by ffprobe: its streams, its size as it shows, its length. Throws when it cannot read. */
export async function probeAv(path: string, ffprobe = 'ffprobe'): Promise<ProbedAv> {
  const stdout = await run(
    ffprobe,
    [
      '-v',
      'error',
      ...INPUT_LIMITS,
      '-show_entries',
      'format=duration:stream=codec_type,width,height:stream_side_data=rotation:stream_tags=rotate',
      '-of',
      'json',
      path,
    ],
    TIMEOUTS_MS.probe,
  );
  const info = ProbeSchema.parse(JSON.parse(stdout));
  const video = info.streams.find((stream) => stream.codec_type === 'video');
  const rotation =
    video?.side_data_list?.find((side) => side.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0;
  const quarter = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const width = video?.width ?? null;
  const height = video?.height ?? null;
  const duration = info.format.duration;
  return {
    hasVideo: video !== undefined,
    hasAudio: info.streams.some((stream) => stream.codec_type === 'audio'),
    width: quarter ? height : width,
    height: quarter ? width : height,
    durationMs: duration !== undefined && Number.isFinite(duration) ? Math.round(duration * 1000) : null,
  };
}

/**
 * The same streams, copied without being re-encoded, in a new container that carries no metadata (ADR 0055 § 3):
 * neither the global tags (position ISO 6709, make, model, software, dates), nor those of the streams, nor chapters,
 * nor the data tracks a phone adds (Apple's `mebx` timed metadata): only the first video and the first audio stream
 * go across. The rotation is a property of the stream, not a tag: it stays. `bitexact` keeps ffmpeg from writing its
 * own name.
 */
export async function cleanAv(
  input: string,
  output: string,
  target: { readonly family: FileFamily; readonly quicktime: boolean; readonly video: boolean },
  ffmpeg = 'ffmpeg',
): Promise<void> {
  const streams = target.video ? ['-map', '0:v:0', '-map', '0:a:0?'] : ['-map', '0:a:0'];
  const container =
    target.family === 'mp3'
      ? ['-f', 'mp3', '-id3v2_version', '0', '-write_id3v1', '0', '-write_xing', '0']
      : target.family === 'adts'
        ? ['-f', 'adts']
        : ['-f', target.quicktime ? 'mov' : 'mp4', '-movflags', '+faststart'];
  await run(
    ffmpeg,
    [
      '-v',
      'error',
      '-y',
      ...INPUT_LIMITS,
      '-i',
      input,
      ...streams,
      '-c',
      'copy',
      '-map_metadata',
      '-1',
      '-map_chapters',
      '-1',
      '-fflags',
      '+bitexact',
      '-flags:v',
      '+bitexact',
      '-flags:a',
      '+bitexact',
      ...container,
      output,
    ],
    TIMEOUTS_MS.clean,
  );
}
