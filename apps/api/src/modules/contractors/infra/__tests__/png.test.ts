import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { logoSidesFit } from '../../domain/agency-logo';
import { pngSize, readPng } from '../png';

import { inventedPng, PNG_SIGNATURE, pngChunk, TRANSPARENT_KINDS, transparentLogo } from './invented-png';

const always = (): boolean => true;
const read = (bytes: Uint8Array) => readPng(bytes, always);

/** A copy of `bytes` with the byte at `index` changed. */
function altered(bytes: Uint8Array, index: number): Uint8Array {
  const copy = Uint8Array.from(bytes);
  copy[index] = (copy[index] ?? 0) ^ 0x5a;
  return copy;
}

/** A PNG of one IHDR (`header`) and one IDAT of `raw` scanlines, CRCs right: what the reader decides is the content. */
function handMade(header: readonly number[], raw: readonly number[]): Uint8Array {
  const ihdr = Buffer.alloc(13);
  header.forEach((value, index) => {
    if (index < 2) ihdr.writeUInt32BE(value, index * 4);
    else ihdr.writeUInt8(value, index + 6);
  });
  return new Uint8Array(
    Buffer.concat([
      PNG_SIGNATURE,
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', deflateSync(Buffer.from(raw))),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

describe('Réglages › Facturation : lire un PNG sans lui faire confiance', () => {
  it.each(Object.entries(TRANSPARENT_KINDS))('finds the one transparent pixel of a %s', (_, bytes) => {
    const reading = read(bytes);
    expect(reading).toMatchObject({ kind: 'read', transparent: true });
  });

  it('gives the size from the header, odd sides included', () => {
    expect(read(transparentLogo(240, 80))).toEqual({
      kind: 'read',
      size: { width: 240, height: 80 },
      transparent: true,
    });
    expect(pngSize(TRANSPARENT_KINDS['RGBA 16 bits entrelacé'] ?? new Uint8Array())).toEqual({
      width: 97,
      height: 71,
    });
  });

  it('says opaque a PNG whose every pixel is opaque, alpha channel or not', () => {
    const opaque = (colorType: 6 | 2, interlaced: boolean) =>
      inventedPng({
        width: 90,
        height: 64,
        colorType,
        bitDepth: 8,
        interlaced,
        pixel: () => (colorType === 6 ? [14, 30, 61, 255] : [14, 30, 61]),
      });
    expect(read(opaque(6, false))).toMatchObject({ kind: 'read', transparent: false });
    expect(read(opaque(6, true))).toMatchObject({ kind: 'read', transparent: false });
    expect(read(opaque(2, false))).toMatchObject({ kind: 'read', transparent: false });
  });

  it('says opaque a tRNS that makes transparent a colour no pixel uses', () => {
    const unused = inventedPng({
      width: 64,
      height: 64,
      colorType: 3,
      bitDepth: 2,
      palette: [
        [14, 30, 61],
        [255, 255, 255],
        [168, 121, 63],
        [0, 0, 0],
      ],
      transparency: new Uint8Array([255, 255, 255, 0]),
      pixel: (x) => [x % 3],
    });
    expect(read(unused)).toMatchObject({ kind: 'read', transparent: false });
    const keyUnused = inventedPng({
      width: 64,
      height: 64,
      colorType: 2,
      bitDepth: 8,
      transparency: new Uint8Array([0, 255, 0, 255, 0, 255]),
      pixel: () => [14, 30, 61],
    });
    expect(read(keyUnused)).toMatchObject({ kind: 'read', transparent: false });
  });

  it('tells a file that is not a PNG', () => {
    expect(read(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]))).toEqual({ kind: 'not_png' });
    expect(read(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({ kind: 'not_png' });
    expect(read(new Uint8Array())).toEqual({ kind: 'not_png' });
  });

  it('tells a PNG damaged anywhere: a byte changed, a file cut short, no image data', () => {
    const logo = transparentLogo();
    expect(read(altered(logo, 20))).toEqual({ kind: 'damaged' }); // in the header: its CRC no longer matches
    expect(read(altered(logo, logo.length - 30))).toEqual({ kind: 'damaged' }); // in the pixel data
    expect(read(logo.subarray(0, logo.length - 12))).toEqual({ kind: 'damaged' }); // without IEND
    expect(read(logo.subarray(0, 40))).toEqual({ kind: 'damaged' });
    expect(read(PNG_SIGNATURE)).toEqual({ kind: 'damaged' });
    const noData = Buffer.concat([
      PNG_SIGNATURE,
      Buffer.from(logo.subarray(8, 33)), // the header chunk as it was
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
    expect(read(noData)).toEqual({ kind: 'damaged' });
  });

  it('tells a header PNG does not allow, and a palette image without its palette', () => {
    // width, height, bit depth, colour type, compression, filter, interlace
    expect(read(handMade([64, 64, 3, 6, 0, 0, 0], []))).toEqual({ kind: 'damaged' });
    expect(read(handMade([64, 64, 8, 5, 0, 0, 0], []))).toEqual({ kind: 'damaged' });
    expect(read(handMade([0, 64, 8, 6, 0, 0, 0], []))).toEqual({ kind: 'damaged' });
    expect(read(handMade([64, 64, 8, 6, 1, 0, 0], []))).toEqual({ kind: 'damaged' });
    expect(read(handMade([64, 64, 8, 6, 0, 0, 2], []))).toEqual({ kind: 'damaged' });
    expect(read(handMade([2, 1, 8, 3, 0, 0, 0], [0, 0, 0]))).toEqual({ kind: 'damaged' });
  });

  it('tells a palette index past the palette, in a late pass of an interlaced image too', () => {
    const indexed = (bitDepth: 2 | 8, entries: number, interlaced: boolean, last: number) =>
      inventedPng({
        width: 70,
        height: 64,
        colorType: 3,
        bitDepth,
        interlaced,
        palette: Array.from({ length: entries }, (_, index) => [index * 40, 30, 61] as const),
        transparency: new Uint8Array([255, 0]),
        pixel: (x, y) => [x === 69 && y === 63 ? last : (x + y) % 2],
      });
    expect(read(indexed(2, 3, false, 3))).toEqual({ kind: 'damaged' });
    expect(read(indexed(2, 3, true, 3))).toEqual({ kind: 'damaged' });
    expect(read(indexed(8, 2, false, 200))).toEqual({ kind: 'damaged' });
    expect(read(indexed(2, 4, true, 3))).toMatchObject({ kind: 'read', transparent: true }); // the four entries 2 bits reach
    expect(read(indexed(8, 3, false, 2))).toMatchObject({ kind: 'read', transparent: true });
  });

  it('tells pixel data of another size than the header gives, or an unknown filter', () => {
    const row = [0, 1, 2, 3, 0]; // filter 0, then one RGBA pixel, transparent
    expect(read(handMade([1, 1, 8, 6, 0, 0, 0], row))).toMatchObject({ kind: 'read', transparent: true });
    expect(read(handMade([1, 1, 8, 6, 0, 0, 0], [...row, 9]))).toEqual({ kind: 'damaged' });
    expect(read(handMade([1, 1, 8, 6, 0, 0, 0], row.slice(0, 4)))).toEqual({ kind: 'damaged' });
    expect(read(handMade([1, 1, 8, 6, 0, 0, 0], [7, 1, 2, 3, 0]))).toEqual({ kind: 'damaged' });
    expect(read(handMade([1, 1, 8, 6, 0, 0, 0], [1, 1, 2, 3, 0]))).toMatchObject({
      kind: 'read',
      transparent: true,
    });
  });

  it('never inflates pixel data past what the header gives, however small the file', () => {
    // 4 000 × 1 000 RGBA would be 16 MB: ten times more zeros in a few kilobytes is refused, never inflated whole.
    const bomb = handMade([100, 100, 8, 6, 0, 0, 0], new Array<number>(100 * 401 * 10).fill(0));
    expect(bomb.length).toBeLessThan(10_000);
    expect(read(bomb)).toEqual({ kind: 'damaged' });
  });

  it('decodes no pixel of a PNG whose sides are out of bounds', () => {
    const huge = handMade([5_000, 64, 8, 6, 0, 0, 0], [0]);
    expect(readPng(huge, logoSidesFit)).toEqual({
      kind: 'read',
      size: { width: 5_000, height: 64 },
      transparent: null,
    });
  });
});
