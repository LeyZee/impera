import { UnreadableFile } from '../../domain/errors';

/**
 * The metadata of a photo removed byte by byte, the image itself never decoded nor re-encoded (ADR 0055 § 3): EXIF
 * (position GPS, appareil, dates), XMP, comments, text chunks. What the picture needs to show as she took it stays:
 * its orientation (rewritten alone in a minimal EXIF), its colour profile (ICC, which names no device), the JFIF and
 * Adobe markers. Anything after the image's end (an iPhone puts a second picture there, with its own EXIF) is cut.
 * Each cleaner also gives the size the picture shows at, after its rotation, and throws `UnreadableFile` on a file
 * whose structure it cannot follow.
 */
export interface CleanedStill {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

const u16be = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u32be = (b: Uint8Array, at: number): number => u16be(b, at) * 0x10000 + u16be(b, at + 2);
const u16le = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, at: number): number => u16le(b, at) | ((b[at + 2] ?? 0) << 16);
const u32le = (b: Uint8Array, at: number): number => u16le(b, at) + u16le(b, at + 2) * 0x10000;
const ascii = (b: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...b.subarray(at, at + length));

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Orientations 5 to 8 turn the picture a quarter: its width shows as its height. */
const turned = (orientation: number): boolean => orientation >= 5 && orientation <= 8;

/** The Orientation tag (0x0112) of a TIFF block (EXIF), 1 when absent or unreadable. */
export function orientationOf(tiff: Uint8Array): number {
  if (tiff.length < 8) return 1;
  const order = ascii(tiff, 0, 2);
  if (order !== 'II' && order !== 'MM') return 1;
  const u16 = order === 'II' ? u16le : u16be;
  const u32 = order === 'II' ? u32le : u32be;
  const ifd = u32(tiff, 4);
  const count = u16(tiff, ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return 1;
    if (u16(tiff, entry) === 0x0112) {
      const value = u16(tiff, entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** An APP1 holding a minimal EXIF: the Orientation tag alone, big-endian. */
function orientationApp1(orientation: number): Uint8Array {
  const tiff = [
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0,
    0,
    0,
    8,
    0,
    1,
    0x01,
    0x12,
    0,
    3,
    0,
    0,
    0,
    1,
    0,
    orientation,
    0,
    0,
    0,
    0,
    0,
    0,
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]; // « Exif\0\0 », then the TIFF block
  const length = payload.length + 2;
  return new Uint8Array([0xff, 0xe1, length >> 8, length & 0xff, ...payload]);
}

/** The SOF markers that carry the frame's size (not DHT C4, JPG C8, DAC CC). */
const isFrame = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/** Which APPn segments stay: JFIF (APP0), the ICC profile (APP2), Adobe's colour transform (APP14). */
function keepsApp(marker: number, segment: Uint8Array): boolean {
  if (marker === 0xe0) return ascii(segment, 4, 5) === 'JFIF\0';
  if (marker === 0xe2) return ascii(segment, 4, 12) === 'ICC_PROFILE\0';
  if (marker === 0xee) return ascii(segment, 4, 5) === 'Adobe';
  return false;
}

export function cleanJpeg(bytes: Uint8Array): CleanedStill {
  if (u16be(bytes, 0) !== 0xffd8) throw new UnreadableFile('no JPEG start');
  const kept: Uint8Array[] = [];
  let orientation = 1;
  let width = 0;
  let height = 0;
  let at = 2;
  let ended = false;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) throw new UnreadableFile(`no marker at ${String(at)}`);
    let markerAt = at + 1;
    while (bytes[markerAt] === 0xff) markerAt += 1;
    const marker = bytes[markerAt] ?? 0;
    if (marker === 0xd9) {
      ended = true;
      break;
    }
    // Restart markers and TEM carry no length.
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      kept.push(bytes.subarray(at, markerAt + 1));
      at = markerAt + 1;
      continue;
    }
    const length = u16be(bytes, markerAt + 1);
    const end = markerAt + 1 + length;
    if (length < 2 || end > bytes.length) throw new UnreadableFile('segment past the end');
    const segment = bytes.subarray(markerAt - 1, end);
    if (marker === 0xe1 && ascii(segment, 4, 6) === 'Exif\0\0') {
      orientation = orientationOf(segment.subarray(10));
    } else if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      if (keepsApp(marker, segment)) kept.push(segment);
    } else {
      if (isFrame(marker)) {
        height = u16be(segment, 5);
        width = u16be(segment, 7);
      }
      kept.push(segment);
    }
    at = end;
    if (marker === 0xda) {
      // The entropy-coded data, up to the next marker that is neither a stuffed byte nor a restart.
      let scan = at;
      while (scan + 1 < bytes.length) {
        const next = bytes[scan + 1] ?? 0;
        if (bytes[scan] === 0xff && next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break;
        scan += 1;
      }
      kept.push(bytes.subarray(at, scan));
      at = scan;
    }
  }
  if (!ended || width === 0 || height === 0) throw new UnreadableFile('no frame or no end');
  const head = [new Uint8Array([0xff, 0xd8]), ...(orientation === 1 ? [] : [orientationApp1(orientation)])];
  return {
    bytes: concat([...head, ...kept, new Uint8Array([0xff, 0xd9])]),
    width: turned(orientation) ? height : width,
    height: turned(orientation) ? width : height,
  };
}

/** The PNG chunks that carry words or dates: dropped, never their pixels nor their colours. */
const PNG_DROPPED = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

export function cleanPng(bytes: Uint8Array): CleanedStill {
  if (ascii(bytes, 0, 8) !== '\x89PNG\r\n\x1a\n') throw new UnreadableFile('no PNG signature');
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let width = 0;
  let height = 0;
  let orientation = 1;
  let at = 8;
  for (;;) {
    const length = u32be(bytes, at);
    const type = ascii(bytes, at + 4, 4);
    const end = at + 12 + length;
    if (end > bytes.length) throw new UnreadableFile('chunk past the end');
    if (type === 'IHDR') {
      width = u32be(bytes, at + 8);
      height = u32be(bytes, at + 12);
    }
    if (type === 'eXIf') orientation = orientationOf(bytes.subarray(at + 8, at + 8 + length));
    if (!PNG_DROPPED.has(type)) kept.push(bytes.subarray(at, end));
    at = end;
    if (type === 'IEND') break;
  }
  if (width === 0 || height === 0) throw new UnreadableFile('no IHDR');
  return {
    bytes: concat(kept),
    width: turned(orientation) ? height : width,
    height: turned(orientation) ? width : height,
  };
}

/** VP8X flags: EXIF (bit 3) and XMP (bit 2) said absent once their chunks are gone. */
const VP8X_METADATA = 0x08 | 0x04;

export function cleanWebp(bytes: Uint8Array): CleanedStill {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') throw new UnreadableFile('no WebP');
  const end = Math.min(bytes.length, 8 + u32le(bytes, 4));
  const kept: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let orientation = 1;
  let at = 12;
  while (at + 8 <= end) {
    const type = ascii(bytes, at, 4);
    const size = u32le(bytes, at + 4);
    const next = at + 8 + size + (size % 2);
    if (at + 8 + size > end) throw new UnreadableFile('chunk past the end');
    const data = bytes.subarray(at + 8, at + 8 + size);
    if (type === 'EXIF')
      orientation = orientationOf(ascii(data, 0, 6) === 'Exif\0\0' ? data.subarray(6) : data);
    if (type === 'EXIF' || type === 'XMP ') {
      at = next;
      continue;
    }
    const chunk = bytes.slice(at, Math.min(next, end));
    if (type === 'VP8X') {
      chunk[8] = (chunk[8] ?? 0) & ~VP8X_METADATA;
      width = u24le(data, 4) + 1;
      height = u24le(data, 7) + 1;
    } else if (type === 'VP8 ' && width === 0) {
      width = u16le(data, 6) & 0x3fff;
      height = u16le(data, 8) & 0x3fff;
    } else if (type === 'VP8L' && width === 0) {
      const bits = u32le(data, 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
    kept.push(chunk);
    at = next;
  }
  if (width === 0 || height === 0) throw new UnreadableFile('no frame');
  const body = concat(kept);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  const size = body.length + 4;
  header.set([size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, (size >>> 24) & 0xff], 4);
  return {
    bytes: concat([header, body]),
    width: turned(orientation) ? height : width,
    height: turned(orientation) ? width : height,
  };
}

interface Box {
  readonly type: string;
  /** Where its content starts, after the size and the type (and the 64-bit size). */
  readonly start: number;
  readonly end: number;
}

function boxesIn(bytes: Uint8Array, from: number, to: number): Box[] {
  const boxes: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = u32be(bytes, at);
    let start = at + 8;
    if (size === 1) {
      size = u32be(bytes, at + 8) * 0x1_0000_0000 + u32be(bytes, at + 12);
      start = at + 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < 8 || at + size > to) throw new UnreadableFile('box past its parent');
    boxes.push({ type: ascii(bytes, at + 4, 4), start, end: at + size });
    at += size;
  }
  return boxes;
}

const childOf = (boxes: readonly Box[], type: string): Box | undefined =>
  boxes.find((box) => box.type === type);

/** An unsigned integer of `size` bytes (0, 4 or 8), big-endian. */
function uint(bytes: Uint8Array, at: number, size: number): number {
  if (size === 0) return 0;
  if (size === 4) return u32be(bytes, at);
  if (size === 8) return u32be(bytes, at) * 0x1_0000_0000 + u32be(bytes, at + 4);
  throw new UnreadableFile(`integer of ${String(size)} bytes`);
}

/**
 * HEIF (an iPhone's HEIC): the EXIF item and every XMP item (`mime`) are written over with zeros, in place, so that
 * no offset of the file moves and the image stays as it was. Its orientation is a property of the image (`irot`),
 * not an EXIF tag: nothing to keep aside.
 */
export function cleanHeif(source: Uint8Array): CleanedStill {
  const bytes = source.slice();
  const meta = childOf(boxesIn(bytes, 0, bytes.length), 'meta');
  if (meta === undefined) throw new UnreadableFile('no meta box');
  const children = boxesIn(bytes, meta.start + 4, meta.end);
  const iinf = childOf(children, 'iinf');
  const iloc = childOf(children, 'iloc');
  if (iinf === undefined || iloc === undefined) throw new UnreadableFile('no iinf or iloc');

  // The items to blank: EXIF and XMP, by their ids.
  const blanked = new Set<number>();
  const iinfVersion = bytes[iinf.start] ?? 0;
  for (const infe of boxesIn(bytes, iinf.start + 4 + (iinfVersion === 0 ? 2 : 4), iinf.end)) {
    if (infe.type !== 'infe') continue;
    const version = bytes[infe.start] ?? 0;
    if (version < 2) continue;
    const id = version === 2 ? u16be(bytes, infe.start + 4) : u32be(bytes, infe.start + 4);
    const typeAt = infe.start + 4 + (version === 2 ? 2 : 4) + 2;
    const itemType = ascii(bytes, typeAt, 4);
    if (itemType === 'Exif' || itemType === 'mime') blanked.add(id);
  }

  // Their bytes, from the item locations: in the file (construction 0) or in `idat` (construction 1).
  const idat = childOf(children, 'idat');
  const v = bytes[iloc.start] ?? 0;
  let at = iloc.start + 4;
  const offsetSize = (bytes[at] ?? 0) >> 4;
  const lengthSize = (bytes[at] ?? 0) & 0x0f;
  const baseOffsetSize = (bytes[at + 1] ?? 0) >> 4;
  const indexSize = v === 1 || v === 2 ? (bytes[at + 1] ?? 0) & 0x0f : 0;
  at += 2;
  const count = v < 2 ? u16be(bytes, at) : u32be(bytes, at);
  at += v < 2 ? 2 : 4;
  for (let i = 0; i < count; i += 1) {
    const id = v < 2 ? u16be(bytes, at) : u32be(bytes, at);
    at += v < 2 ? 2 : 4;
    const construction = v === 1 || v === 2 ? u16be(bytes, at) & 0x0f : 0;
    if (v === 1 || v === 2) at += 2;
    at += 2; // data_reference_index
    const base = uint(bytes, at, baseOffsetSize);
    at += baseOffsetSize;
    const extents = u16be(bytes, at);
    at += 2;
    for (let e = 0; e < extents; e += 1) {
      at += indexSize;
      const offset = uint(bytes, at, offsetSize);
      at += offsetSize;
      const length = uint(bytes, at, lengthSize);
      at += lengthSize;
      if (!blanked.has(id)) continue;
      if (construction > 1) throw new UnreadableFile('metadata built from other items');
      const origin = construction === 1 ? (idat?.start ?? -1) : 0;
      if (origin < 0) throw new UnreadableFile('metadata in a missing idat');
      const from = origin + base + offset;
      // A length of 0 means « to the end of its container ».
      const to = length === 0 ? (construction === 1 ? (idat?.end ?? from) : bytes.length) : from + length;
      if (to > bytes.length) throw new UnreadableFile('metadata past the end');
      bytes.fill(0, from, to);
    }
    if (at > iloc.end) throw new UnreadableFile('iloc past its box');
  }

  // The size the primary image shows at: its `ispe`, turned by its `irot`.
  const pitm = childOf(children, 'pitm');
  const iprp = childOf(children, 'iprp');
  if (pitm === undefined || iprp === undefined) throw new UnreadableFile('no primary item');
  const primary =
    (bytes[pitm.start] ?? 0) === 0 ? u16be(bytes, pitm.start + 4) : u32be(bytes, pitm.start + 4);
  const properties = boxesIn(bytes, iprp.start, iprp.end);
  const ipco = childOf(properties, 'ipco');
  const ipma = childOf(properties, 'ipma');
  if (ipco === undefined || ipma === undefined) throw new UnreadableFile('no item properties');
  const list = boxesIn(bytes, ipco.start, ipco.end);
  const ipmaVersion = bytes[ipma.start] ?? 0;
  const wide = ((bytes[ipma.start + 3] ?? 0) & 1) === 1;
  let width = 0;
  let height = 0;
  let quarter = false;
  let p = ipma.start + 4;
  const entries = u32be(bytes, p);
  p += 4;
  for (let i = 0; i < entries; i += 1) {
    const id = ipmaVersion < 1 ? u16be(bytes, p) : u32be(bytes, p);
    p += ipmaVersion < 1 ? 2 : 4;
    const associations = bytes[p] ?? 0;
    p += 1;
    for (let a = 0; a < associations; a += 1) {
      const index = wide ? u16be(bytes, p) & 0x7fff : (bytes[p] ?? 0) & 0x7f;
      p += wide ? 2 : 1;
      if (id !== primary || index === 0) continue;
      const property = list[index - 1];
      if (property?.type === 'ispe') {
        width = u32be(bytes, property.start + 4);
        height = u32be(bytes, property.start + 8);
      }
      if (property?.type === 'irot') quarter = ((bytes[property.start] ?? 0) & 1) === 1;
    }
  }
  if (width === 0 || height === 0) throw new UnreadableFile('no size for the primary image');
  return { bytes, width: quarter ? height : width, height: quarter ? width : height };
}
