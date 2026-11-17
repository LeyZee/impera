/** How long her phone may take to read a video's length before the server reads it instead (ADR 0070 § 2). */
const PROBE_MS = 8_000;

/** A video's or a vocal's length, in milliseconds, read on her phone; `null` when it cannot say (the server will). */
export function durationOf(file: File, kind: 'video' | 'audio'): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(kind);
    const done = (value: number | null): void => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => {
      done(null);
    }, PROBE_MS);
    media.preload = 'metadata';
    media.onloadedmetadata = () => {
      done(Number.isFinite(media.duration) ? Math.round(media.duration * 1000) : null);
    };
    media.onerror = () => {
      done(null);
    };
    media.src = url;
  });
}
