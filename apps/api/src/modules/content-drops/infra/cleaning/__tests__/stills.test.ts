import { crc32 } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { UnreadableFile } from '../../../domain/errors';
import { cleanHeif, cleanJpeg, cleanPng, cleanWebp, orientationOf } from '../stills';

/**
 * Photos built byte by byte, with the metadata a phone writes (an invented device, a position in Paris), and the proof
 * that none of it is left after the cleaning while the picture and its orientation stay. Invented data only.
 */
const DEVICE = 'Telephone Invente 9';
const PLACE = '48.8566N 2.3522E';

const bytesOf = (...parts: (string | number[] | Uint8Array)[]): Uint8Array =>
  new Uint8Array(
    parts.flatMap((part) => (typeof part === 'string' ? [...Buffer.from(part, 'latin1')] : [...part])),
  );
const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le32 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

/** A TIFF block, big-endian: Orientation, Make (the device), and the position written as text after the IFD. */
function tiff(orientation: number): Uint8Array {
  const make = `${DEVICE}\0`;
  const place = `${PLACE}\0`;
  const ifdEnd = 8 + 2 + 3 * 12 + 4;
  return bytesOf(
    'MM',
    [0, 0x2a],
    be32(8),
    be16(3),
    [0x01, 0x12, 0, 3],
    be32(1),
    [0, orientation, 0, 0],
    [0x01, 0x0f, 0, 2],
    be32(make.length),
    be32(ifdEnd),
    [0x88, 0x25, 0, 2],
    be32(place.length),
    be32(ifdEnd + make.length),
    be32(0),
    make,
    place,
  );
}

const segment = (marker: number, payload: Uint8Array): Uint8Array =>
  bytesOf([0xff, marker], be16(payload.length + 2), payload);

describe('content-drops › the photos’ metadata removed byte by byte (ADR 0055 § 3)', () => {
  it('reads the orientation of a TIFF block, 1 when absent', () => {
    expect(orientationOf(tiff(6))).toBe(6);
    expect(orientationOf(new Uint8Array(4))).toBe(1);
  });

  it('JPEG: drops EXIF, XMP, comments and the picture after the end, keeps JFIF, ICC and the orientation', () => {
    const jfif = segment(0xe0, bytesOf('JFIF\0', [1, 2, 0, 0, 1, 0, 1, 0, 0]));
    const exif = segment(0xe1, bytesOf('Exif\0\0', tiff(6)));
    const xmp = segment(0xe1, bytesOf('http://ns.adobe.com/xap/1.0/\0', `<x:xmpmeta>${DEVICE}</x:xmpmeta>`));
    const icc = segment(0xe2, bytesOf('ICC_PROFILE\0', [1, 1], 'profil-couleur'));
    const comment = segment(0xfe, bytesOf(PLACE));
    const dqt = segment(0xdb, bytesOf([0], new Array<number>(64).fill(1)));
    const sof = segment(0xc0, bytesOf([8], be16(30), be16(40), [1, 1, 0x11, 0]));
    const dht = segment(0xc4, bytesOf([0], new Array<number>(16).fill(0)));
    const sos = segment(0xda, bytesOf([1, 1, 0, 0, 63, 0]));
    // Entropy-coded data with a stuffed 0xFF and a restart marker inside.
    const scan = bytesOf([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]);
    const trailer = bytesOf([0xff, 0xd8], segment(0xe1, bytesOf('Exif\0\0', tiff(1))), [0xff, 0xd9]);
    const photo = bytesOf(
      [0xff, 0xd8],
      jfif,
      exif,
      xmp,
      icc,
      comment,
      dqt,
      sof,
      dht,
      sos,
      scan,
      [0xff, 0xd9],
      trailer,
    );

    const cleaned = cleanJpeg(photo);
    expect(text(cleaned.bytes)).not.toContain(DEVICE);
    expect(text(cleaned.bytes)).not.toContain(PLACE);
    expect(text(cleaned.bytes)).toContain('JFIF');
    expect(text(cleaned.bytes)).toContain('profil-couleur');
    // Orientation 6 turns a 40 × 30 frame upright: 30 wide, 40 high, and the tag is kept alone.
    expect([cleaned.width, cleaned.height]).toEqual([30, 40]);
    const kept = cleanJpeg(cleaned.bytes);
    expect([kept.width, kept.height]).toEqual([30, 40]);
    expect(text(cleaned.bytes)).toContain(text(bytesOf(dqt, sof, dht, sos, scan)));
    expect(Array.from(cleaned.bytes.subarray(-2))).toEqual([0xff, 0xd9]);
    // Nothing after the end: the second picture an iPhone appends is gone.
    expect(text(cleaned.bytes).indexOf('\xff\xd8', 2)).toBe(-1);
  });

  it('JPEG: refuses a file it cannot follow', () => {
    expect(() => cleanJpeg(bytesOf([0xff, 0xd8, 0xff, 0xc0, 0x00]))).toThrow(UnreadableFile);
    expect(() => cleanJpeg(bytesOf('not a jpeg'))).toThrow(UnreadableFile);
  });

  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const body = bytesOf(type, data);
    return bytesOf(be32(data.length), body, be32(crc32(body)));
  };

  it('PNG: drops eXIf, text chunks and the time, keeps the image and its colour profile', () => {
    const ihdr = chunk('IHDR', bytesOf(be32(20), be32(10), [8, 2, 0, 0, 0]));
    const png = bytesOf(
      '\x89PNG\r\n\x1a\n',
      ihdr,
      chunk('iCCP', bytesOf('profil\0', [0], 'xx')),
      chunk('eXIf', tiff(1)),
      chunk('tEXt', bytesOf('Make\0', DEVICE)),
      chunk('iTXt', bytesOf('XML:com.adobe.xmp\0', [0, 0, 0, 0], PLACE)),
      chunk('tIME', bytesOf([0x07, 0xea, 11, 3, 12, 0, 0])),
      chunk('IDAT', bytesOf([1, 2, 3])),
      chunk('IEND', new Uint8Array()),
      'apres la fin',
    );
    const cleaned = cleanPng(png);
    expect(text(cleaned.bytes)).not.toContain(DEVICE);
    expect(text(cleaned.bytes)).not.toContain(PLACE);
    expect(text(cleaned.bytes)).not.toContain('tIME');
    expect(text(cleaned.bytes)).not.toContain('apres la fin');
    expect(text(cleaned.bytes)).toContain('iCCP');
    expect([cleaned.width, cleaned.height]).toEqual([20, 10]);
  });

  const riffChunk = (type: string, data: Uint8Array): Uint8Array =>
    bytesOf(type, le32(data.length), data, data.length % 2 === 1 ? [0] : []);

  it('WebP: drops the EXIF and XMP chunks and their flags, fixes the RIFF size', () => {
    // VP8X: flags with EXIF (0x08) and XMP (0x04), canvas 50 × 70 (stored minus one, 24 bits each).
    const vp8x = riffChunk('VP8X', bytesOf([0x0c, 0, 0, 0], [49, 0, 0], [69, 0, 0]));
    const vp8l = riffChunk('VP8L', bytesOf([0x2f, 0, 0, 0, 0, 1, 2]));
    const body = bytesOf('WEBP', vp8x, vp8l, riffChunk('EXIF', tiff(1)), riffChunk('XMP ', bytesOf(PLACE)));
    const webp = bytesOf('RIFF', le32(body.length), body);
    const cleaned = cleanWebp(webp);
    expect(text(cleaned.bytes)).not.toContain(DEVICE);
    expect(text(cleaned.bytes)).not.toContain(PLACE);
    expect(cleaned.bytes[20]).toBe(0);
    expect(Buffer.from(cleaned.bytes).readUInt32LE(4)).toBe(cleaned.bytes.length - 8);
    expect([cleaned.width, cleaned.height]).toEqual([50, 70]);
  });

  const box = (type: string, ...content: Uint8Array[]): Uint8Array => {
    const inner = bytesOf(...content);
    return bytesOf(be32(inner.length + 8), type, inner);
  };
  const fullBox = (type: string, version: number, flags: number, ...content: Uint8Array[]): Uint8Array =>
    box(type, bytesOf([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff]), ...content);

  /** A HEIC as an iPhone lays it out: the image, its EXIF and its XMP as items, their bytes in `mdat`. */
  function heic(): { readonly file: Uint8Array; readonly image: Uint8Array } {
    const image = bytesOf('donnees-image-hevc');
    const exif = bytesOf([0, 0, 0, 6], 'Exif\0\0', tiff(1));
    const xmp = bytesOf(`<x:xmpmeta>${PLACE}</x:xmpmeta>`);
    const infe = (id: number, type: string, extra: Uint8Array = new Uint8Array()) =>
      fullBox('infe', 2, 0, bytesOf(be16(id), be16(0), type), extra);
    const iinf = fullBox(
      'iinf',
      0,
      0,
      bytesOf(be16(3)),
      infe(1, 'hvc1', bytesOf('\0')),
      infe(2, 'Exif', bytesOf('\0')),
      infe(3, 'mime', bytesOf('\0application/rdf+xml\0')),
    );
    // The item locations, written once the offsets are known: 4-byte offsets and lengths, no base.
    const location = (offsets: readonly number[]) =>
      fullBox(
        'iloc',
        0,
        0,
        bytesOf([0x44, 0x00], be16(3)),
        ...[image, exif, xmp].map((item, index) =>
          bytesOf(be16(index + 1), be16(0), be16(1), be32(offsets[index] ?? 0), be32(item.length)),
        ),
      );
    const iprp = box(
      'iprp',
      box('ipco', fullBox('ispe', 0, 0, bytesOf(be32(4032), be32(3024))), box('irot', bytesOf([1]))),
      fullBox('ipma', 0, 0, bytesOf(be32(1), be16(1), [2, 0x81, 0x02])),
    );
    const build = (offsets: readonly number[]) =>
      bytesOf(
        box('ftyp', bytesOf('heic', be32(0), 'mif1heic')),
        fullBox(
          'meta',
          0,
          0,
          fullBox('hdlr', 0, 0, bytesOf(be32(0), 'pict', new Array<number>(13).fill(0))),
          fullBox('pitm', 0, 0, bytesOf(be16(1))),
          iinf,
          location(offsets),
          iprp,
        ),
      );
    const head = build([0, 0, 0]);
    const start = head.length + 8;
    const offsets = [start, start + image.length, start + image.length + exif.length];
    return { file: bytesOf(build(offsets), box('mdat', image, exif, xmp)), image };
  }

  it('HEIC: writes zeros over the EXIF and XMP items in place, the image and its offsets untouched', () => {
    const { file, image } = heic();
    expect(text(file)).toContain(DEVICE);
    const cleaned = cleanHeif(file);
    expect(cleaned.bytes.length).toBe(file.length);
    expect(text(cleaned.bytes)).not.toContain(DEVICE);
    expect(text(cleaned.bytes)).not.toContain(PLACE);
    expect(text(cleaned.bytes)).toContain(text(image));
    // `irot` of a quarter turn: the 4032 × 3024 picture shows upright.
    expect([cleaned.width, cleaned.height]).toEqual([3024, 4032]);
    expect(() => cleanHeif(bytesOf(box('ftyp', bytesOf('heic'))))).toThrow(UnreadableFile);
  });
});
