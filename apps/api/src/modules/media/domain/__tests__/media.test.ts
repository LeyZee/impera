import { describe, expect, it } from 'vitest';

import {
  descriptionKey,
  keyframeRate,
  mediaKindOf,
  needsConversion,
  sniffMediaType,
  spreadFrames,
} from '../media';

describe('media domain', () => {
  it('tells photos from videos and refuses the rest', () => {
    expect(mediaKindOf('image/jpeg')).toBe('image');
    expect(mediaKindOf('video/mp4')).toBe('video');
    expect(mediaKindOf('application/pdf')).toBeUndefined();
  });

  it('keys a description by content, vocabulary, origin and describer', () => {
    const scope = { origin: 'fan', senseVersion: 'gemini-3.8-flash:abc' } as const;
    const a = descriptionKey(new Uint8Array([1, 2]), scope);
    expect(a).toBe(descriptionKey(new Uint8Array([1, 2]), scope));
    expect(a).not.toBe(descriptionKey(new Uint8Array([1, 3]), scope));
    expect(a).not.toBe(descriptionKey(new Uint8Array([1, 2]), { ...scope, senseVersion: 'grok-4.7:abc' }));
    expect(a).not.toBe(descriptionKey(new Uint8Array([1, 2]), { ...scope, origin: 'creator' }));
    expect(a).toMatch(/:1\.1\.0:fan:gemini-3\.8-flash:abc$/);
  });

  it('converts what the vision API refuses: WebP, HEIC, huge files', () => {
    expect(needsConversion('image/jpeg', 1_000)).toBe(false);
    expect(needsConversion('image/png', 1_000)).toBe(false);
    expect(needsConversion('image/webp', 1_000)).toBe(true);
    expect(needsConversion('image/heic', 1_000)).toBe(true);
    expect(needsConversion('image/jpeg', 25 * 1024 * 1024)).toBe(true);
  });

  it('keeps every keyframe of a short video, and an even spread with the ending of a long one', () => {
    expect(spreadFrames([1, 2, 3])).toEqual([1, 2, 3]);
    const long = spreadFrames(Array.from({ length: 180 }, (_, i) => i));
    expect(long).toHaveLength(24);
    expect(long[0]).toBe(0);
    expect(long.at(-1)).toBe(179);
  });
});

describe('keyframeRate', () => {
  it('decodes one frame a second for a short video, 24 at most for a long one', () => {
    expect(keyframeRate(9)).toBe(1);
    expect(keyframeRate(240)).toBe(0.1);
    expect(keyframeRate(0)).toBe(1);
  });

  it('reads the type of a file from its first bytes, not from its name', () => {
    const bytes = (...parts: (string | number[])[]) =>
      new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...new TextEncoder().encode(p)] : p)));
    expect(sniffMediaType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMediaType(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffMediaType(bytes('GIF89a'))).toBe('image/gif');
    expect(sniffMediaType(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))).toBe('image/webp');
    expect(sniffMediaType(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe('video/webm');
    expect(sniffMediaType(bytes([0, 0, 0, 0x18], 'ftypheic'))).toBe('image/heic');
    expect(sniffMediaType(bytes([0, 0, 0, 0x18], 'ftypavif'))).toBe('image/avif');
    expect(sniffMediaType(bytes([0, 0, 0, 0x14], 'ftypqt  '))).toBe('video/quicktime');
    expect(sniffMediaType(bytes([0, 0, 0, 0x18], 'ftypisom'))).toBe('video/mp4');
    expect(sniffMediaType(bytes('<html>'))).toBeUndefined();
    expect(sniffMediaType(new Uint8Array())).toBeUndefined();
  });
});
