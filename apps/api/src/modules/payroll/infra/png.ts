import { crc32, inflateSync } from 'node:zlib';

import type { PngReading, PngSize } from '../domain/agency-logo';

/**
 * Reads a file as a PNG (ISO/IEC 15948) without trusting it: every chunk whole and its CRC right, a header PNG allows,
 * the pixel data inflated to exactly the size its header gives (never more: a small file cannot swell in memory) and
 * every scanline unfiltered, interlaced or not. Then whether one pixel at least is transparent: an alpha below its
 * maximum, or a colour the `tRNS` chunk makes transparent, actually used. PDFKit draws every PNG this accepts (its test
 * renders each kind).
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Channels per pixel, by colour type: grey, RGB, palette index, grey and alpha, RGBA. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** The bit depths PNG allows for each colour type. */
const DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};
/** Adam7's seven passes: first column, first row, column step, row step. A plain image is one pass of steps 1. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;
const PLAIN = [[0, 0, 1, 1]] as const;

interface Header extends PngSize {
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlaced: boolean;
}

interface Chunks {
  readonly header: Header;
  readonly palette: Uint8Array | null;
  readonly transparency: Uint8Array | null;
  readonly data: Buffer;
}

class Damaged extends Error {}

/** Each chunk in order, its CRC checked; the header first, `IEND` last (what follows it is never read). */
function chunksOf(bytes: Uint8Array): Chunks {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = SIGNATURE.length;
  let header: Header | null = null;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const data: Uint8Array[] = [];
  for (;;) {
    if (offset + 12 > bytes.length) throw new Damaged();
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) throw new Damaged();
    const typed = bytes.subarray(offset + 4, offset + 8 + length);
    if (crc32(typed) !== view.getUint32(offset + 8 + length)) throw new Damaged();
    const type = String.fromCharCode(...typed.subarray(0, 4));
    const body = typed.subarray(4);
    offset += 12 + length;
    if (header === null) {
      if (type !== 'IHDR' || length !== 13) throw new Damaged();
      header = headerOf(body);
      continue;
    }
    if (type === 'IEND') break;
    if (type === 'IHDR') throw new Damaged();
    if (type === 'PLTE') palette = body;
    if (type === 'tRNS') transparency = body;
    if (type === 'IDAT') data.push(body);
  }
  if (data.length === 0) throw new Damaged();
  if (header.colorType === 3 && (palette === null || palette.length % 3 !== 0)) throw new Damaged();
  return { header, palette, transparency, data: Buffer.concat(data) };
}

function headerOf(body: Uint8Array): Header {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const [bitDepth, colorType, compression, filter, interlace] = body.subarray(8, 13);
  if (
    width === 0 ||
    height === 0 ||
    width > 0x7fffffff ||
    height > 0x7fffffff ||
    colorType === undefined ||
    bitDepth === undefined ||
    !(DEPTHS[colorType] ?? []).includes(bitDepth) ||
    compression !== 0 ||
    filter !== 0 ||
    (interlace !== 0 && interlace !== 1)
  ) {
    throw new Damaged();
  }
  return { width, height, bitDepth, colorType, interlaced: interlace === 1 };
}

interface Pass {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly width: number;
  readonly height: number;
  readonly rowBytes: number;
}

/** The passes that hold pixels, with their sizes; the bytes they take once inflated. */
function passesOf(header: Header): { readonly passes: readonly Pass[]; readonly length: number } {
  const bits = (CHANNELS[header.colorType] ?? 1) * header.bitDepth;
  const passes: Pass[] = [];
  let length = 0;
  for (const [x, y, dx, dy] of header.interlaced ? ADAM7 : PLAIN) {
    const width = x < header.width ? Math.ceil((header.width - x) / dx) : 0;
    const height = y < header.height ? Math.ceil((header.height - y) / dy) : 0;
    if (width === 0 || height === 0) continue;
    const rowBytes = Math.ceil((width * bits) / 8);
    passes.push({ x, y, dx, dy, width, height, rowBytes });
    length += height * (1 + rowBytes);
  }
  return { passes, length };
}

const paeth = (left: number, up: number, upLeft: number): number => {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
};

/** Undoes each scanline's filter in place, pass by pass; an unknown filter is damage. */
function unfilter(raw: Buffer, passes: readonly Pass[], bytesPerPixel: number, onRow: RowReader): void {
  let offset = 0;
  for (const pass of passes) {
    let previous: Uint8Array = new Uint8Array(pass.rowBytes);
    for (let row = 0; row < pass.height; row += 1) {
      const filter = raw[offset];
      if (filter === undefined || filter > 4) throw new Damaged();
      const line = raw.subarray(offset + 1, offset + 1 + pass.rowBytes);
      for (let i = 0; filter !== 0 && i < line.length; i += 1) {
        const left = i >= bytesPerPixel ? (line[i - bytesPerPixel] ?? 0) : 0;
        const up = previous[i] ?? 0;
        const upLeft = i >= bytesPerPixel ? (previous[i - bytesPerPixel] ?? 0) : 0;
        const value = line[i] ?? 0;
        if (filter === 1) line[i] = (value + left) & 0xff;
        else if (filter === 2) line[i] = (value + up) & 0xff;
        else if (filter === 3) line[i] = (value + ((left + up) >> 1)) & 0xff;
        else line[i] = (value + paeth(left, up, upLeft)) & 0xff;
      }
      onRow(line, pass.width);
      previous = line;
      offset += 1 + pass.rowBytes;
    }
  }
}

type RowReader = (line: Uint8Array, width: number) => void;

/** One sample of `bitDepth` bits at index `index` of a scanline (big-endian, as PNG packs them). */
function sampleAt(line: Uint8Array, index: number, bitDepth: number): number {
  if (bitDepth === 16) return ((line[index * 2] ?? 0) << 8) | (line[index * 2 + 1] ?? 0);
  if (bitDepth === 8) return line[index] ?? 0;
  const perByte = 8 / bitDepth;
  const byte = line[Math.floor(index / perByte)] ?? 0;
  const shift = 8 - bitDepth * ((index % perByte) + 1);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

/**
 * A reader that tells whether a scanline holds a transparent pixel, by the colour type: an alpha sample below its
 * maximum; a palette index whose `tRNS` entry is below 255; the grey or RGB colour `tRNS` names. `null` when no pixel
 * can be transparent at all (no alpha channel, no `tRNS`).
 */
function transparencyReader(chunks: Chunks): ((line: Uint8Array, width: number) => boolean) | null {
  const { bitDepth, colorType } = chunks.header;
  const channels = CHANNELS[colorType] ?? 1;
  const max = (1 << bitDepth) - 1;
  if (colorType === 4 || colorType === 6) {
    return (line, width) => {
      for (let pixel = 0; pixel < width; pixel += 1) {
        if (sampleAt(line, pixel * channels + channels - 1, bitDepth) < max) return true;
      }
      return false;
    };
  }
  const key = chunks.transparency;
  if (key === null) return null;
  if (colorType === 3) {
    const clear = new Set<number>();
    key.forEach((alpha, index) => {
      if (alpha < 255) clear.add(index);
    });
    if (clear.size === 0) return null;
    return (line, width) => {
      for (let pixel = 0; pixel < width; pixel += 1) {
        if (clear.has(sampleAt(line, pixel, bitDepth))) return true;
      }
      return false;
    };
  }
  if (key.length !== channels * 2) return null;
  const keyView = new DataView(key.buffer, key.byteOffset, key.byteLength);
  const colour = Array.from({ length: channels }, (_, channel) => keyView.getUint16(channel * 2) & max);
  return (line, width) => {
    for (let pixel = 0; pixel < width; pixel += 1) {
      if (colour.every((value, channel) => sampleAt(line, pixel * channels + channel, bitDepth) === value))
        return true;
    }
    return false;
  };
}

/** The size from the header alone, for a logo already kept (its bytes were read whole when it was added). */
export function pngSize(bytes: Uint8Array): PngSize {
  const reading = readPng(bytes, () => false);
  if (reading.kind !== 'read') throw new Error('A kept logo is not a readable PNG');
  return reading.size;
}

/**
 * Reads `bytes` as a PNG; its pixels are decoded only when `decodable(size)` says the sides are in bounds, else
 * `transparent` is `null`.
 */
export function readPng(bytes: Uint8Array, decodable: (size: PngSize) => boolean): PngReading {
  if (bytes.length < SIGNATURE.length || SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    return { kind: 'not_png' };
  }
  try {
    const chunks = chunksOf(bytes);
    const { header } = chunks;
    const size = { width: header.width, height: header.height };
    if (!decodable(size)) return { kind: 'read', size, transparent: null };
    const { passes, length } = passesOf(header);
    let raw: Buffer;
    try {
      raw = inflateSync(chunks.data, { maxOutputLength: length });
    } catch {
      throw new Damaged();
    }
    if (raw.length !== length) throw new Damaged();
    const transparentRow = transparencyReader(chunks);
    let transparent = false;
    const bytesPerPixel = Math.max(1, ((CHANNELS[header.colorType] ?? 1) * header.bitDepth) >> 3);
    unfilter(raw, passes, bytesPerPixel, (line, width) => {
      if (!transparent && transparentRow !== null) transparent = transparentRow(line, width);
    });
    return { kind: 'read', size, transparent };
  } catch (error) {
    if (error instanceof Damaged) return { kind: 'damaged' };
    throw error;
  }
}
