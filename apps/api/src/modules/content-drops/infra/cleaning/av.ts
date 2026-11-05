import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { promisify } from 'node:util';

import { z } from 'zod';

import type { FileFamily } from '../../domain/sniff';

const execFileAsync = promisify(execFile);

/**
 * What ffmpeg may open, as in the `media` module (audit de sécurité du 02/11, M4): only the containers a phone or a
 * camera sends (ADR 0070 § 2: ISO-BMFF, Matroska and WebM, AVI, then MP3 and ADTS for a vocal), never a playlist, a
 * list of other files nor a device, and nothing but the file itself, never a URL.
 */
const INPUT_LIMITS = [
  '-format_whitelist',
  'mov,matroska,avi,mp3,aac',
  '-protocol_whitelist',
  'file',
] as const;

/**
 * A crafted file must free its worker slot: the job's retry decides what comes next. A copy reads and writes the
 * file once, so its limit grows with its size like a download (ADR 0070 § 4: a second per 10 Mo, plus three minutes
 * for the slowest disk); a conversion with the length of the video, three times over plus ten minutes, four hours
 * at most, and four hours when its length is not known.
 */
const PROBE_TIMEOUT_MS = 15_000;
const MINUTE_MS = 60_000;
const copyTimeoutMs = (bytes: number): number => 3 * MINUTE_MS + Math.ceil(bytes / 10_000_000) * 1000;
const conversionTimeoutMs = (durationMs: number | null): number =>
  durationMs === null ? 240 * MINUTE_MS : Math.min(240 * MINUTE_MS, 3 * durationMs + 10 * MINUTE_MS);

const ProbeSchema = z.object({
  format: z.object({ duration: z.coerce.number().optional() }).default({}),
  streams: z
    .array(
      z.object({
        index: z.number().int(),
        codec_type: z.string().optional(),
        codec_name: z.string().optional(),
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
  /** ffmpeg's name of the first video stream's codec (`h264`, `hevc`, `prores`, `vp9`…); `null` without one. */
  readonly videoCodec: string | null;
  /** The audio stream a video keeps: its first in AAC, else its first; `null` without one. */
  readonly audio: { readonly index: number; readonly codec: string | null } | null;
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
      'format=duration:stream=index,codec_type,codec_name,width,height:stream_side_data=rotation:stream_tags=rotate',
      '-of',
      'json',
      path,
    ],
    PROBE_TIMEOUT_MS,
  );
  const info = ProbeSchema.parse(JSON.parse(stdout));
  const video = info.streams.find((stream) => stream.codec_type === 'video');
  const rotation =
    video?.side_data_list?.find((side) => side.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0;
  const quarter = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const width = video?.width ?? null;
  const height = video?.height ?? null;
  const duration = info.format.duration;
  const audios = info.streams.filter((stream) => stream.codec_type === 'audio');
  const audio = audios.find((stream) => stream.codec_name === 'aac') ?? audios[0];
  return {
    hasVideo: video !== undefined,
    hasAudio: audio !== undefined,
    videoCodec: video === undefined ? null : (video.codec_name ?? null),
    audio: audio === undefined ? null : { index: audio.index, codec: audio.codec_name ?? null },
    width: quarter ? height : width,
    height: quarter ? width : height,
    durationMs: duration !== undefined && Number.isFinite(duration) ? Math.round(duration * 1000) : null,
  };
}

/**
 * How a video's picture gets across (ADR 0070 § 3): `copy`, as it came, when it is H.264 or HEVC in ISO-BMFF (every
 * iPhone video); `remux`, the same picture moved into an MP4, when it is H.264 or HEVC in another container; `convert`
 * into H.264 otherwise (ProRes, VP8, VP9, AV1, MPEG-4 part 2, MJPEG…).
 */
export type VideoRoute = 'copy' | 'remux' | 'convert';

export function videoRouteOf(family: FileFamily, videoCodec: string | null): VideoRoute {
  if (videoCodec !== 'h264' && videoCodec !== 'hevc') return 'convert';
  return family === 'isobmff' ? 'copy' : 'remux';
}

/** What `cleanAv` writes: a vocal as it came, or a video by its route. */
export type AvTarget =
  | { readonly video: false; readonly family: FileFamily; readonly bytes: number }
  | {
      readonly video: true;
      readonly route: VideoRoute;
      /** A QuickTime file copied stays QuickTime; anything else comes out as an MP4. */
      readonly quicktime: boolean;
      readonly audio: ProbedAv['audio'];
      readonly bytes: number;
      readonly durationMs: number | null;
    };

/** The 4K the platforms take at most: the longer side brought down to 3 840, even, the ratio kept. */
const AT_MOST_4K =
  "scale=w='if(gte(iw,ih),min(3840,trunc(iw/2)*2),-2)':h='if(gte(iw,ih),-2,min(3840,trunc(ih/2)*2))'";

/** H.264 that every platform reads (ADR 0070 § 3): High profile, 8 bits 4:2:0, near lossless to the eye. */
function h264(): string[] {
  // `veryfast` keeps a 4K minute within its limit on a small machine; CRF 18 holds the quality whatever the preset.
  // One core is left to the API and the agent, which share the machine.
  const threads = String(Math.max(1, availableParallelism() - 1));
  return [
    ...['-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p'],
    ...['-vf', AT_MOST_4K, '-threads', threads],
    // x264 writes its name and settings in an SEI unit of the picture: every SEI goes, none is needed to play it.
    ...['-bsf:v', 'filter_units=remove_types=6'],
  ];
}

/**
 * Her file, its metadata removed (ADR 0055 § 3), into a new container that carries none: neither the global tags
 * (position ISO 6709, make, model, software, dates), nor those of the streams, nor chapters, nor the data tracks a
 * phone adds (Apple's `mebx` timed metadata). A vocal keeps its stream as it came. A video keeps its first picture
 * and one sound, by its route (`videoRouteOf`): the picture copied, its rotation with it, or converted, its rotation
 * applied; the sound copied when it is AAC, converted into AAC at 192 kbit/s otherwise. `bitexact` keeps ffmpeg from
 * writing its own name.
 */
export async function cleanAv(
  input: string,
  output: string,
  target: AvTarget,
  ffmpeg = 'ffmpeg',
): Promise<void> {
  let codecs: string[];
  let container: string[];
  let timeout: number;
  if (!target.video) {
    codecs = ['-map', '0:a:0', '-c', 'copy'];
    container =
      target.family === 'mp3'
        ? ['-f', 'mp3', '-id3v2_version', '0', '-write_id3v1', '0', '-write_xing', '0']
        : target.family === 'adts'
          ? ['-f', 'adts']
          : ['-f', 'mp4', '-movflags', '+faststart'];
    timeout = copyTimeoutMs(target.bytes);
  } else {
    const sound =
      target.audio === null
        ? []
        : [
            ...['-map', `0:${String(target.audio.index)}`],
            ...(target.audio.codec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k']),
          ];
    const picture = target.route === 'convert' ? h264() : ['-c:v', 'copy'];
    codecs = ['-map', '0:v:0', ...picture, ...sound];
    const mov = target.route === 'copy' && target.quicktime;
    container = ['-f', mov ? 'mov' : 'mp4', '-movflags', '+faststart'];
    timeout =
      target.route === 'convert' ? conversionTimeoutMs(target.durationMs) : copyTimeoutMs(target.bytes);
  }
  await run(
    ffmpeg,
    [
      ...['-v', 'error', '-y', ...INPUT_LIMITS, '-i', input, ...codecs],
      ...['-map_metadata', '-1', '-map_chapters', '-1'],
      ...['-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact'],
      ...container,
      output,
    ],
    timeout,
  );
}
