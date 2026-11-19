import { describe, expect, it } from 'vitest';

import { previewTypeOf } from '../vault-preview';

const bytes = (...parts: (number[] | string)[]): Uint8Array =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === 'string' ? Array.from({ length: part.length }, (_, at) => part.charCodeAt(at)) : part,
    ),
  );

describe('a vault preview’s type, from its first bytes (ADR 0138 § 2)', () => {
  it('knows the image types a small picture may be', () => {
    expect(previewTypeOf(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(previewTypeOf(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(previewTypeOf(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe('image/webp');
    expect(previewTypeOf(bytes('GIF89a'))).toBe('image/gif');
    expect(previewTypeOf(bytes([0, 0, 0, 0x1c], 'ftypavif'))).toBe('image/avif');
  });

  it('refuses anything else: a video, a page, nothing', () => {
    expect(previewTypeOf(bytes([0, 0, 0, 0x18], 'ftypisom'))).toBeNull();
    expect(previewTypeOf(bytes('<!doctype html>'))).toBeNull();
    expect(previewTypeOf(new Uint8Array(0))).toBeNull();
  });
});
