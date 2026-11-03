import { err, ok, type MediaDescription, type Result } from '@impera/contracts';

import { descriptionKey, keyframeRate, mediaKindOf, needsConversion, spreadFrames } from '../domain/media';

interface MediaFile {
  /** A fan's media is described to react to it; one of a bundle, once at import, to talk about it and sell it. */
  readonly origin: 'fan' | 'creator';
  readonly mediaType: string;
  readonly data: Uint8Array;
}

export interface ExtractedFrame {
  readonly atS: number;
  readonly mediaType: string;
  readonly data: Uint8Array;
}

/** File work on a media (ffmpeg in infra): for a model that cannot read a video, it is cut into images and sound. */
export interface MediaTools {
  probe(video: Uint8Array): Promise<{ readonly durationS: number; readonly hasAudio: boolean }>;
  /** `perSecond` images a second at most (1 or less), near-duplicates dropped, each dated. */
  keyframes(video: Uint8Array, perSecond: number): Promise<ExtractedFrame[]>;
  /** The sound track, as mono MP3. */
  audioTrack(video: Uint8Array): Promise<Uint8Array>;
  /** Any image, as a JPEG the vision API accepts. */
  toJpeg(image: Uint8Array): Promise<Uint8Array>;
}

export type SenseRequest =
  | {
      readonly origin: MediaFile['origin'];
      readonly kind: 'image';
      readonly mediaType: string;
      readonly data: Uint8Array;
    }
  | {
      readonly origin: MediaFile['origin'];
      readonly kind: 'video';
      readonly mediaType: string;
      readonly data: Uint8Array;
      readonly durationS: number;
      /** Cut on demand, only when the vision model in use cannot read a video file (Grok, as fallback). */
      readonly keyframes: () => Promise<{
        readonly frames: readonly ExtractedFrame[];
        readonly transcript?: string;
      }>;
    };

interface SensedMedia {
  readonly description: MediaDescription;
  /** Described by the fallback model: used for this message, not kept, so the next one asks the main model. */
  readonly isFallback: boolean;
}

/** The `sense` role of the LLM gateway, seen from this module. */
export type Senser = (request: SenseRequest) => Promise<Result<SensedMedia, string>>;

/** Speech to text, seen from this module. `durationS` prices the call when the provider gives no duration. */
export type Transcriber = (audio: Uint8Array, durationS?: number) => Promise<Result<string, string>>;

/** media_descriptions until the database exists (P0-03). */
export interface MediaDescriptionStore {
  find(key: string): Promise<MediaDescription | undefined>;
  save(key: string, description: MediaDescription): Promise<void>;
}

export interface DescribeMediaDeps {
  readonly sense: Senser;
  /** Without it, a video is described from its images only. */
  readonly transcribe?: Transcriber;
  readonly store: MediaDescriptionStore;
  readonly tools: MediaTools;
  /** Model and sense prompt version, part of the cache key: changing either describes the media again. */
  readonly senseVersion: string;
}

type DescribeMediaError = 'unsupported_media' | 'unreadable_media' | 'sense_failed';

export interface MediaDescriber {
  describe(file: MediaFile): Promise<Result<MediaDescription, { code: DescribeMediaError; detail?: string }>>;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : 'unknown';
}

export function createMediaDescriber(deps: DescribeMediaDeps): MediaDescriber {
  async function prepare(file: MediaFile, kind: 'image' | 'video'): Promise<SenseRequest> {
    if (kind === 'image') {
      const isAccepted = !needsConversion(file.mediaType, file.data.byteLength);
      return {
        origin: file.origin,
        kind,
        mediaType: isAccepted ? file.mediaType : 'image/jpeg',
        data: isAccepted ? file.data : await deps.tools.toJpeg(file.data),
      };
    }
    const { durationS, hasAudio } = await deps.tools.probe(file.data);
    const keyframes = async (): Promise<{ frames: ExtractedFrame[]; transcript?: string }> => {
      const frames = spreadFrames(await deps.tools.keyframes(file.data, keyframeRate(durationS)));
      if (!hasAudio || deps.transcribe === undefined) return { frames };
      // A failed transcription leaves the images, which still say most of it.
      const heard = await deps.transcribe(await deps.tools.audioTrack(file.data), durationS);
      return heard.ok && heard.value.trim() !== '' ? { frames, transcript: heard.value } : { frames };
    };
    return { origin: file.origin, kind, mediaType: file.mediaType, data: file.data, durationS, keyframes };
  }

  return {
    async describe(file) {
      const kind = mediaKindOf(file.mediaType);
      if (kind === undefined) return err({ code: 'unsupported_media', detail: file.mediaType });
      const key = descriptionKey(file.data, { origin: file.origin, senseVersion: deps.senseVersion });
      const cached = await deps.store.find(key);
      if (cached !== undefined) return ok(cached);

      let request: SenseRequest;
      try {
        request = await prepare(file, kind);
      } catch (error) {
        return err({ code: 'unreadable_media', detail: reason(error) });
      }
      const sensed = await deps.sense(request);
      if (!sensed.ok) return err({ code: 'sense_failed', detail: sensed.error });
      if (!sensed.value.isFallback) await deps.store.save(key, sensed.value.description);
      return ok(sensed.value.description);
    },
  };
}
