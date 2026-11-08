import { readFile } from 'node:fs/promises';

import {
  err,
  ok,
  type DescriptionReviewReason,
  type DropMediaDescription,
  type Result,
} from '@impera/contracts';

import { reviewReasonsOf } from '../domain/drop-review';
import { keyframeRate, needsConversion, spreadFrames } from '../domain/media';

import type { ExtractedFrame, Transcriber } from './describe-media';

/** The work of `MediaTools` on a file already on disk: a dropped video is never read into memory (ADR 0083). */
export interface FileMediaTools {
  probe(path: string): Promise<{ readonly durationS: number; readonly hasAudio: boolean }>;
  keyframes(path: string, perSecond: number): Promise<ExtractedFrame[]>;
  audioTrack(path: string): Promise<Uint8Array>;
  toJpeg(path: string): Promise<Uint8Array>;
}

/** What the code knows of the drop, given to the model as data (ADR 0083 § 5). */
export interface DropContext {
  readonly category: string;
  readonly step: {
    readonly number: number;
    readonly name: string;
    readonly instruction: string | null;
    readonly position: number;
    readonly count: number;
  } | null;
}

/** Above it, a video is read by its keyframes: a model that takes video gets it whole only below (the gateway's own cap). */
export const DROP_VIDEO_INLINE_MAX_BYTES = 20 * 1024 * 1024;

export type DropSenseRequest = {
  readonly context: DropContext;
  readonly creatorId: string;
} & (
  | { readonly kind: 'image'; readonly mediaType: string; readonly data: Uint8Array }
  | {
      readonly kind: 'video';
      readonly mediaType: string;
      readonly data: Uint8Array | null;
      readonly durationS: number;
      readonly keyframes: () => Promise<{
        readonly frames: readonly ExtractedFrame[];
        readonly transcript?: string;
      }>;
    }
);

export interface DropSensed {
  readonly description: DropMediaDescription;
  readonly model: string;
  readonly promptHash: string;
}

/** `budget`: the daily cap is spent, nothing was called: asked again later, never abandoned (ADR 0083 § 8). */
export type DropSenseError = 'budget' | 'failed';

/** The gateway's `describeDrop`, seen from this module. */
export type DropSenser = (request: DropSenseRequest) => Promise<Result<DropSensed, DropSenseError>>;

interface DropMediaFile {
  readonly creatorId: string;
  readonly path: string;
  readonly mime: string;
  readonly kind: 'image' | 'video';
  readonly bytes: number;
  readonly context: DropContext;
}

export interface DescribedDrop extends DropSensed {
  /** Empty when nothing holds it back; any reason keeps it for a human before use (ADR 0083 § 3 to 5). */
  readonly reviewReasons: readonly DescriptionReviewReason[];
}

type DescribeDropError = 'budget' | 'failed' | 'unreadable';

export interface DropDescriber {
  describe(file: DropMediaFile): Promise<Result<DescribedDrop, { code: DescribeDropError; detail?: string }>>;
}

export interface DropDescriberDeps {
  readonly sense: DropSenser;
  readonly tools: FileMediaTools;
  /** Without it, a video is described from its images, or its own sound when the model takes video. */
  readonly transcribe?: Transcriber;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message.slice(0, 200) : 'unknown');

/**
 * A photo or a video she dropped, described in detail and alone (ADR 0083 § 1 to 5). A description that points to
 * another media is asked once more; still so, it is kept with its reason, for a human to correct.
 */
export function createDropDescriber(deps: DropDescriberDeps): DropDescriber {
  async function prepare(file: DropMediaFile): Promise<DropSenseRequest> {
    const base = { context: file.context, creatorId: file.creatorId };
    if (file.kind === 'image') {
      const isAccepted = !needsConversion(file.mime, file.bytes);
      return {
        ...base,
        kind: 'image',
        mediaType: isAccepted ? file.mime : 'image/jpeg',
        data: isAccepted ? new Uint8Array(await readFile(file.path)) : await deps.tools.toJpeg(file.path),
      };
    }
    const { durationS, hasAudio } = await deps.tools.probe(file.path);
    const keyframes = async (): Promise<{ frames: ExtractedFrame[]; transcript?: string }> => {
      const frames = spreadFrames(await deps.tools.keyframes(file.path, keyframeRate(durationS)));
      if (!hasAudio || deps.transcribe === undefined) return { frames };
      const heard = await deps.transcribe(await deps.tools.audioTrack(file.path), durationS);
      return heard.ok && heard.value.trim() !== '' ? { frames, transcript: heard.value } : { frames };
    };
    return {
      ...base,
      kind: 'video',
      mediaType: file.mime,
      data: file.bytes <= DROP_VIDEO_INLINE_MAX_BYTES ? new Uint8Array(await readFile(file.path)) : null,
      durationS,
      keyframes,
    };
  }

  return {
    async describe(file) {
      let request: DropSenseRequest;
      try {
        request = await prepare(file);
      } catch (error) {
        return err({ code: 'unreadable', detail: reason(error) });
      }
      let sensed = await deps.sense(request);
      if (!sensed.ok) return err({ code: sensed.error });
      let reasons = reviewReasonsOf(sensed.value.description);
      if (reasons.includes('back_reference')) {
        const again = await deps.sense(request);
        if (again.ok) {
          sensed = again;
          reasons = reviewReasonsOf(again.value.description);
        }
      }
      return ok({ ...sensed.value, reviewReasons: reasons });
    },
  };
}
