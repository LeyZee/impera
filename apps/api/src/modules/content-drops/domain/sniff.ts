import type { DropMime } from '@impera/contracts';

/**
 * What a file is by its first bytes, never by the type her phone declared (ADR 0055 § 3): the cleaning that follows
 * is the one of the family found, and a file that is not what it says is refused.
 */
export type FileFamily = 'jpeg' | 'png' | 'webp' | 'heif' | 'isobmff' | 'ebml' | 'avi' | 'mp3' | 'adts';

const ascii = (bytes: Uint8Array, from: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(from, from + length));

/** The brands of an `ftyp` that mean a still image (HEIF, HEIC, AVIF are refused as not in the list). */
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1']);

/** The family of a file from its first 32 bytes at least; `null` when none of the accepted ones. */
export function sniff(head: Uint8Array): FileFamily | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.length >= 8 && ascii(head, 0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'webp';
  // A video in another container (ADR 0070 § 2): Matroska and WebM open on the EBML header, AVI is a RIFF of `AVI `.
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
    return 'ebml';
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'AVI ') return 'avi';
  if (head.length >= 12 && ascii(head, 4, 4) === 'ftyp') {
    return HEIF_BRANDS.has(ascii(head, 8, 4)) ? 'heif' : 'isobmff';
  }
  // An old QuickTime file starts with its atoms, no `ftyp`.
  if (head.length >= 8 && ['moov', 'mdat', 'wide', 'free'].includes(ascii(head, 4, 4))) return 'isobmff';
  if (head.length >= 3 && ascii(head, 0, 3) === 'ID3') return 'mp3';
  // An MPEG audio frame (MP3, `FFF/FFE` then layer III) or an ADTS one (AAC, layer bits 00).
  if (head.length >= 2 && head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0) {
    return ((head[1] ?? 0) & 0x06) === 0 ? 'adts' : 'mp3';
  }
  return null;
}

/** The families each declared type may hold: a `.mov` may be an MP4 inside, a vocal `.m4a` an MP4 too. */
const FAMILIES_OF: Readonly<Record<DropMime, readonly FileFamily[]>> = {
  'image/jpeg': ['jpeg'],
  'image/png': ['png'],
  'image/heic': ['heif'],
  'image/heif': ['heif'],
  'image/webp': ['webp'],
  'video/mp4': ['isobmff'],
  'video/quicktime': ['isobmff'],
  'video/x-m4v': ['isobmff'],
  'video/3gpp': ['isobmff'],
  'video/x-matroska': ['ebml'],
  'video/webm': ['ebml'],
  'video/x-msvideo': ['avi'],
  'audio/mpeg': ['mp3'],
  'audio/mp4': ['isobmff'],
  'audio/x-m4a': ['isobmff'],
  'audio/aac': ['adts', 'isobmff'],
};

/** Whether the bytes found are of the type declared. */
export const holds = (mime: DropMime, family: FileFamily): boolean => FAMILIES_OF[mime].includes(family);
