/** How long her phone may take to read a video's length before the server reads it instead (ADR 0070 § 2). */
const PROBE_MS = 8_000;

/** What her phone reads of a video or a vocal: its length in milliseconds and a video's size in pixels. */
export interface MediaFacts {
  readonly ms: number | null;
  readonly width: number | null;
  readonly height: number | null;
}

const UNKNOWN: MediaFacts = { ms: null, width: null, height: null };

/** A video's or a vocal's length and size, read on her phone; `null` where it cannot say (the server will). */
export function factsOf(file: File, kind: 'video' | 'audio'): Promise<MediaFacts> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(kind);
    const done = (value: MediaFacts): void => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => {
      done(UNKNOWN);
    }, PROBE_MS);
    media.preload = 'metadata';
    media.onloadedmetadata = () => {
      // A video her phone cannot decode says 0 × 0: unknown, not a size.
      const isSized = media instanceof HTMLVideoElement && media.videoWidth > 0 && media.videoHeight > 0;
      done({
        ms: Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : null,
        width: isSized ? media.videoWidth : null,
        height: isSized ? media.videoHeight : null,
      });
    };
    media.onerror = () => {
      done(UNKNOWN);
    };
    media.src = url;
  });
}

/** A video's or a vocal's length, in milliseconds, read on her phone; `null` when it cannot say (the server will). */
export async function durationOf(file: File, kind: 'video' | 'audio'): Promise<number | null> {
  return (await factsOf(file, kind)).ms;
}
