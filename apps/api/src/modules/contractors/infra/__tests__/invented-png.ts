import { crc32, deflateSync } from 'node:zlib';

/** What an invented PNG is made of: its header, its pixels (one sample per channel), its optional chunks. */
export interface PngRecipe {
  readonly width: number;
  readonly height: number;
  /** 0 grey, 2 RGB, 3 palette, 4 grey and alpha, 6 RGBA. */
  readonly colorType: 0 | 2 | 3 | 4 | 6;
  readonly bitDepth: 1 | 2 | 4 | 8 | 16;
  readonly interlaced?: boolean;
  /** The samples of the pixel at (x, y), one per channel (a palette index for colour type 3). */
  readonly pixel: (x: number, y: number) => readonly number[];
  readonly palette?: readonly (readonly [number, number, number])[];
  readonly transparency?: Uint8Array;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const;
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

export const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Packs samples of `bitDepth` bits big-endian, as PNG does. */
function pack(samples: readonly number[], bitDepth: number): number[] {
  if (bitDepth === 16) return samples.flatMap((value) => [value >> 8, value & 0xff]);
  if (bitDepth === 8) return [...samples];
  const bytes: number[] = [];
  const perByte = 8 / bitDepth;
  samples.forEach((value, index) => {
    if (index % perByte === 0) bytes.push(0);
    const last = bytes.length - 1;
    bytes[last] = (bytes[last] ?? 0) | (value << (8 - bitDepth * ((index % perByte) + 1)));
  });
  return bytes;
}

const paeth = (left: number, up: number, upLeft: number): number => {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
};

/** Filters a scanline with `filter` (0 to 4) against the one above, as an encoder would. */
function filterLine(
  line: readonly number[],
  previous: readonly number[],
  filter: number,
  bpp: number,
): number[] {
  return line.map((value, i) => {
    const left = i >= bpp ? (line[i - bpp] ?? 0) : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bpp ? (previous[i - bpp] ?? 0) : 0;
    const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter] ?? 0;
    return (value - predicted) & 0xff;
  });
}

/**
 * An invented PNG built byte by byte (no image library): each scanline takes the next of the five filters in turn, so
 * that a reader must undo all of them; interlaced with Adam7 when asked.
 */
export function inventedPng(recipe: PngRecipe): Uint8Array {
  const channels = CHANNELS[recipe.colorType];
  const bpp = Math.max(1, (channels * recipe.bitDepth) >> 3);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(recipe.width, 0);
  header.writeUInt32BE(recipe.height, 4);
  header.writeUInt8(recipe.bitDepth, 8);
  header.writeUInt8(recipe.colorType, 9);
  header.writeUInt8(recipe.interlaced === true ? 1 : 0, 12);
  const passes = recipe.interlaced === true ? ADAM7 : ([[0, 0, 1, 1]] as const);
  const raw: number[] = [];
  let filter = 0;
  for (const [x0, y0, dx, dy] of passes) {
    let previous: number[] = [];
    for (let y = y0; y < recipe.height; y += dy) {
      const samples: number[] = [];
      for (let x = x0; x < recipe.width; x += dx) samples.push(...recipe.pixel(x, y));
      if (samples.length === 0) continue;
      const line = pack(samples, recipe.bitDepth);
      raw.push(filter, ...filterLine(line, previous, filter, bpp));
      previous = line;
      filter = (filter + 1) % 5;
    }
  }
  const chunks = [pngChunk('IHDR', header)];
  if (recipe.palette !== undefined) chunks.push(pngChunk('PLTE', Buffer.from(recipe.palette.flat())));
  if (recipe.transparency !== undefined) chunks.push(pngChunk('tRNS', recipe.transparency));
  chunks.push(pngChunk('IDAT', deflateSync(Buffer.from(raw))), pngChunk('IEND', Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat([PNG_SIGNATURE, ...chunks]));
}

/** A navy mark on its left half, transparent on its right: a logo the settings keep. */
export const transparentLogo = (width = 240, height = 80): Uint8Array =>
  inventedPng({
    width,
    height,
    colorType: 6,
    bitDepth: 8,
    pixel: (x) => [0x0e, 0x1e, 0x3d, x < width / 2 ? 255 : 0],
  });

/**
 * One invented PNG of each kind a logo may be, each with exactly one transparent pixel, at an odd place so that an
 * interlaced one has it in a late pass: the reader must find it, and PDFKit must draw each.
 */
export const TRANSPARENT_KINDS: Readonly<Record<string, Uint8Array>> = {
  'RGBA 8 bits': inventedPng({
    width: 97,
    height: 71,
    colorType: 6,
    bitDepth: 8,
    pixel: (x, y) => [14, 30, 61, x === 95 && y === 69 ? 0 : 255],
  }),
  'RGBA 16 bits entrelacé': inventedPng({
    width: 97,
    height: 71,
    colorType: 6,
    bitDepth: 16,
    interlaced: true,
    pixel: (x, y) => [3_600, 7_700, 15_600, x === 5 && y === 3 ? 1_000 : 65_535],
  }),
  'gris et alpha 8 bits entrelacé': inventedPng({
    width: 66,
    height: 65,
    colorType: 4,
    bitDepth: 8,
    interlaced: true,
    pixel: (x, y) => [40, x === 65 && y === 64 ? 254 : 255],
  }),
  'gris et alpha 16 bits': inventedPng({
    width: 64,
    height: 64,
    colorType: 4,
    bitDepth: 16,
    pixel: (x, y) => [9_000, x === 1 && y === 1 ? 0 : 65_535],
  }),
  'palette 2 bits et tRNS': inventedPng({
    width: 70,
    height: 64,
    colorType: 3,
    bitDepth: 2,
    palette: [
      [14, 30, 61],
      [255, 255, 255],
      [168, 121, 63],
    ],
    transparency: new Uint8Array([255, 0]),
    pixel: (x, y) => [x === 69 && y === 63 ? 1 : (x + y) % 2 === 0 ? 0 : 2],
  }),
  'gris 1 bit et tRNS': inventedPng({
    width: 64,
    height: 64,
    colorType: 0,
    bitDepth: 1,
    transparency: new Uint8Array([0, 0]),
    pixel: (x, y) => [x === 10 && y === 20 ? 0 : 1],
  }),
  'RGB 16 bits et tRNS entrelacé': inventedPng({
    width: 80,
    height: 64,
    colorType: 2,
    bitDepth: 16,
    interlaced: true,
    transparency: new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    pixel: (x, y) => (x === 3 && y === 7 ? [65_535, 65_535, 65_535] : [3_600, 7_700, 15_600]),
  }),
};
