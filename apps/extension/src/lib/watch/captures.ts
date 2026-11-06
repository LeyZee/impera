import {
  TREND_CAPTURE_MAX_BYTES,
  TREND_CAPTURES_MAX,
  type InstagramPostCode,
  type TrendCapture,
} from '@impera/contracts';

/**
 * The captures of a marked post (ADR 0060 § 2, source 6; VEI-01 lot c2): at most four shots of the visible tab, taken
 * by the service worker with `tabs.captureVisibleTab` while the marked post stays on screen, never by reading the
 * video or a canvas in the page. They live in memory only, until the API has them; never on disk, never kept.
 */

/** Between two shots, so that four of them cover the first seconds of a reel. */
const CAPTURE_GAP_MS = 1_500;
const QUALITIES = [70, 50, 35] as const;

export interface CaptureDeps {
  /** The tab's visible area as a `data:image/jpeg;base64,…` address, or null when it cannot be taken now. */
  readonly shoot: (quality: number) => Promise<string | null>;
  /** The post on screen in the tab now, null when none. */
  readonly onScreen: () => Promise<InstagramPostCode | null>;
  readonly wait: (ms: number) => Promise<void>;
}

/** Bytes of a base64 text once decoded. */
export function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/** A JPEG data address as the API takes it, if it is one and fits. */
export function captureOf(dataUrl: string | null): TrendCapture | null {
  if (dataUrl === null) return null;
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl);
  const data = match?.[1];
  if (data === undefined || decodedBytes(data) > TREND_CAPTURE_MAX_BYTES) return null;
  return { mediaType: 'image/jpeg', data };
}

async function shootFitting(deps: CaptureDeps): Promise<TrendCapture | null> {
  for (const quality of QUALITIES) {
    const shot = await deps.shoot(quality);
    if (shot === null) return null;
    const capture = captureOf(shot);
    if (capture !== null) return capture;
  }
  return null;
}

/** Up to four shots, stopping as soon as the marked post leaves the screen. */
export async function captureMarked(
  code: InstagramPostCode,
  deps: CaptureDeps,
): Promise<readonly TrendCapture[]> {
  const captures: TrendCapture[] = [];
  for (let index = 0; index < TREND_CAPTURES_MAX; index += 1) {
    if (index > 0) await deps.wait(CAPTURE_GAP_MS);
    if ((await deps.onScreen()) !== code) break;
    const capture = await shootFitting(deps);
    if (capture === null) break;
    captures.push(capture);
  }
  return captures;
}
