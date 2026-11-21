import { describe, expect, it } from 'vitest';

import { decodeBlurhash, previewOf } from './preview';

/* Invented hashes: one plain colour built for the test, and the format's own published sample. */
const PLAIN = '00M_Ai'; // one component: rgb(200, 40, 90) everywhere
const SAMPLE = 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH'; // 4 × 3 components

describe('the blurred preview of a vault media (ADR 0030 § 4)', () => {
  it('decodes a one-colour hash to that colour everywhere', () => {
    const pixels = decodeBlurhash(PLAIN, 4);
    expect(pixels).toHaveLength(16);
    expect(new Set(pixels?.map((pixel) => pixel.join(',')))).toEqual(new Set(['200,40,90']));
  });

  it('decodes a richer hash to varied colours, each channel within 0–255', () => {
    const pixels = decodeBlurhash(SAMPLE, 8) ?? [];
    expect(pixels).toHaveLength(64);
    expect(pixels.every((pixel) => pixel.every((channel) => channel >= 0 && channel <= 255))).toBe(true);
    expect(new Set(pixels.map((pixel) => pixel.join(','))).size).toBeGreaterThan(10);
  });

  it('refuses a hash that does not read: too short, a wrong length, a foreign character', () => {
    expect(decodeBlurhash('L0', 4)).toBeNull();
    expect(decodeBlurhash(SAMPLE.slice(0, -2), 4)).toBeNull();
    expect(decodeBlurhash('00M_A"', 4)).toBeNull();
    expect(previewOf('pas un hash')).toBeNull();
  });

  it('draws it as a small BMP in a data address, built from the hash alone', () => {
    const src = previewOf(PLAIN);
    expect(src?.startsWith('data:image/bmp;base64,')).toBe(true);
    const bytes = atob(src?.slice('data:image/bmp;base64,'.length) ?? '');
    // 54 bytes of header, then 16 rows of 16 pixels of 3 bytes (48, already a multiple of 4).
    expect(bytes.length).toBe(54 + 16 * 48);
    expect(bytes.slice(0, 2)).toBe('BM');
    // Blue, green, red: the BMP's own order.
    expect([54, 55, 56].map((at) => bytes.charCodeAt(at))).toEqual([90, 40, 200]);
    expect(previewOf(PLAIN)).toBe(src);
  });
});
