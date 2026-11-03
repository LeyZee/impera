import { createHash } from 'node:crypto';

import { MEDIA_VOCABULARY_VERSION } from '@impera/contracts';

export type MediaKind = 'image' | 'video';

export function mediaKindOf(mediaType: string): MediaKind | undefined {
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType.startsWith('video/')) return 'video';
  return undefined;
}

// What the xAI vision API accepts (docs.x.ai, image understanding): any other image is converted first.
const VISION_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png'];
const VISION_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

export function needsConversion(mediaType: string, sizeBytes: number): boolean {
  return !VISION_IMAGE_TYPES.includes(mediaType) || sizeBytes > VISION_IMAGE_MAX_BYTES;
}

/**
 * One description per file, origin, vocabulary version and describer (model and sense prompt; ai-engine.md,
 * « Cache »): a bundle media is described once at import, and a fan who sends the same picture twice costs
 * one call. Changing the model or the prompt describes the media again.
 */
export function descriptionKey(
  data: Uint8Array,
  scope: { readonly origin: 'fan' | 'creator'; readonly senseVersion: string },
): string {
  const sha256 = createHash('sha256').update(data).digest('hex');
  return `${sha256}:${MEDIA_VOCABULARY_VERSION}:${scope.origin}:${scope.senseVersion}`;
}

/** At most one frame a second, and no more than `max` decoded over the whole video. */
export function keyframeRate(durationS: number, max = 24): number {
  if (!(durationS > 0)) return 1;
  return Math.min(1, max / durationS);
}

/**
 * Keyframes come at one per second, near-duplicates already dropped. Past `max`, keep an even spread
 * that still holds the first and the last: a long video stays affordable and keeps its ending.
 */
export function spreadFrames<T>(frames: readonly T[], max = 24): T[] {
  if (frames.length <= max) return [...frames];
  if (max <= 1) return frames.slice(0, max);
  const step = (frames.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => frames[Math.round(i * step)]).filter(
    (frame): frame is T => frame !== undefined,
  );
}

const ascii = (data: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...data.subarray(from, to));
const startsWith = (data: Uint8Array, bytes: readonly number[]): boolean =>
  bytes.every((b, i) => data[i] === b);

// ISO base media (`ftyp` box) brands: still images (HEIF family) and videos.
const HEIF_BRANDS: readonly string[] = ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'];
const AVIF_BRANDS: readonly string[] = ['avif', 'avis'];

/**
 * The type a file really is, read from its first bytes: a platform's name or extension is not trusted (a file
 * called .jpg can be anything). Undefined: not an image or video the vision reads.
 */
export function sniffMediaType(data: Uint8Array): string | undefined {
  if (startsWith(data, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(data, 0, 6) === 'GIF87a' || ascii(data, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 12) === 'WEBP') return 'image/webp';
  if (startsWith(data, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (ascii(data, 4, 8) === 'ftyp') {
    const brand = ascii(data, 8, 12);
    if (HEIF_BRANDS.includes(brand)) return 'image/heic';
    if (AVIF_BRANDS.includes(brand)) return 'image/avif';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  return undefined;
}
