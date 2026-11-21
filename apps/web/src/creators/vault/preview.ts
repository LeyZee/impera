/*
 * The blurred tile of a vault media (ADR 0030 § 4): the platform's blurhash, a few colours computed from the image and
 * never the image, drawn as a tiny picture the browser smooths when it stretches it. No canvas, no fetch: the bytes
 * are built here, from the hash alone, as a 24-bit BMP in a `data:` address. The decoder follows the blurhash format
 * (base 83, a DC colour then AC components, https://github.com/woltapp/blurhash, MIT), written again here.
 */

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

/** The value of a run of base-83 digits; `null` when one is not a digit. */
function base83(text: string): number | null {
  let value = 0;
  for (const char of text) {
    const digit = DIGITS.indexOf(char);
    if (digit < 0) return null;
    value = value * 83 + digit;
  }
  return value;
}

const toLinear = (channel: number): number => {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const toSrgb = (linear: number): number => {
  const v = Math.min(1, Math.max(0, linear));
  return v <= 0.0031308
    ? Math.floor(v * 12.92 * 255 + 0.5)
    : Math.floor((1.055 * v ** (1 / 2.4) - 0.055) * 255 + 0.5);
};

const signPow = (value: number, exp: number): number => Math.sign(value) * Math.abs(value) ** exp;

type Rgb = readonly [number, number, number];

/** A `size` × `size` square of RGB pixels, rows top to bottom; `null` when the hash does not read. */
export function decodeBlurhash(hash: string, size: number): Rgb[] | null {
  if (hash.length < 6) return null;
  const sizeFlag = base83(hash.charAt(0));
  const maxFlag = base83(hash.charAt(1));
  if (sizeFlag === null || maxFlag === null) return null;
  const numX = (sizeFlag % 9) + 1;
  const numY = Math.floor(sizeFlag / 9) + 1;
  if (hash.length !== 4 + 2 * numX * numY) return null;
  const maxValue = (maxFlag + 1) / 166;
  const colours: Rgb[] = [];
  const dc = base83(hash.slice(2, 6));
  if (dc === null) return null;
  colours.push([toLinear(dc >> 16), toLinear((dc >> 8) & 255), toLinear(dc & 255)]);
  for (let at = 1; at < numX * numY; at += 1) {
    const ac = base83(hash.slice(4 + at * 2, 6 + at * 2));
    if (ac === null) return null;
    const channel = (quant: number): number => signPow((quant - 9) / 9, 2) * maxValue;
    colours.push([channel(Math.floor(ac / 361)), channel(Math.floor(ac / 19) % 19), channel(ac % 19)]);
  }
  const pixels: Rgb[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < numY; j += 1) {
        for (let i = 0; i < numX; i += 1) {
          const basis = Math.cos((Math.PI * x * i) / size) * Math.cos((Math.PI * y * j) / size);
          const colour = colours[i + j * numX];
          if (colour === undefined) return null;
          r += colour[0] * basis;
          g += colour[1] * basis;
          b += colour[2] * basis;
        }
      }
      pixels.push([toSrgb(r), toSrgb(g), toSrgb(b)]);
    }
  }
  return pixels;
}

/** A square of pixels as an uncompressed 24-bit BMP (rows bottom to top, each padded to 4 bytes). */
function bmpOf(pixels: readonly Rgb[], size: number): Uint8Array {
  const row = Math.ceil((size * 3) / 4) * 4;
  const bytes = new Uint8Array(54 + row * size);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, size, true);
  view.setInt32(22, size, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, row * size, true);
  pixels.forEach(([r, g, b], at) => {
    const x = at % size;
    const y = size - 1 - Math.floor(at / size);
    const offset = 54 + y * row + x * 3;
    bytes[offset] = b;
    bytes[offset + 1] = g;
    bytes[offset + 2] = r;
  });
  return bytes;
}

/** How many pixels a side: enough for a smooth blur once stretched, small enough to stay a few hundred bytes. */
const SIDE = 16;

const cache = new Map<string, string | null>();

/** The tile's picture for a blurhash, as a `data:` address; `null` when the hash does not read. Kept once made. */
export function previewOf(hash: string): string | null {
  const kept = cache.get(hash);
  if (kept !== undefined) return kept;
  const pixels = decodeBlurhash(hash, SIDE);
  let made: string | null = null;
  if (pixels !== null) {
    let binary = '';
    for (const byte of bmpOf(pixels, SIDE)) binary += String.fromCharCode(byte);
    made = `data:image/bmp;base64,${btoa(binary)}`;
  }
  cache.set(hash, made);
  return made;
}
