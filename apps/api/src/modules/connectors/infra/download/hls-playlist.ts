/**
 * The two HLS playlists a platform serves for a video (RFC 8216), read as data: a master names its variants, a media
 * playlist its key and its segments. Only what a download needs is kept; any other tag is ignored. Every URI is resolved
 * against the playlist's own address, so the caller checks the host of each before fetching it.
 */

export interface HlsVariant {
  readonly uri: string;
  readonly bandwidth: number;
  /** The picture's height, when the master says it. */
  readonly height: number | null;
}

interface HlsSegment {
  readonly uri: string;
  /** Its key: `null` when the segment is in the clear. */
  readonly key: { readonly uri: string; readonly iv: Buffer } | null;
}

export type HlsPlaylist =
  | { readonly kind: 'master'; readonly variants: readonly HlsVariant[] }
  | { readonly kind: 'media'; readonly segments: readonly HlsSegment[]; readonly ended: boolean };

/** A playlist this download does not take: another encryption, a byte range, or no `#EXTM3U` at all. */
export class HlsUnsupported extends Error {
  override readonly name = 'HlsUnsupported';
}

/** `KEY=value,KEY="quoted, value"` → a map; keys upper-cased as the RFC writes them. */
function attributesOf(list: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gu;
  for (const match of list.matchAll(pattern)) {
    const [, name, raw] = match;
    if (name === undefined || raw === undefined) continue;
    attributes.set(name, raw.startsWith('"') ? raw.slice(1, -1) : raw);
  }
  return attributes;
}

/** The IV of segment `sequence` when the key names none (RFC 8216 § 5.2): its media sequence number, on 16 bytes. */
export function defaultIv(sequence: number): Buffer {
  const iv = Buffer.alloc(16);
  iv.writeUInt32BE(Math.floor(sequence / 2 ** 32), 8);
  iv.writeUInt32BE(sequence % 2 ** 32, 12);
  return iv;
}

function ivOf(hex: string | undefined, sequence: number): Buffer {
  if (hex === undefined) return defaultIv(sequence);
  const digits = hex.replace(/^0x/iu, '');
  if (!/^[0-9a-f]{1,32}$/iu.test(digits)) throw new HlsUnsupported('IV is not a 128-bit hexadecimal number');
  return Buffer.from(digits.padStart(32, '0'), 'hex');
}

export function parseHlsPlaylist(text: string, playlistUrl: string): HlsPlaylist {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines[0] !== '#EXTM3U') throw new HlsUnsupported('not an HLS playlist');
  const resolve = (uri: string): string => new URL(uri, playlistUrl).toString();

  if (lines.some((line) => line.startsWith('#EXT-X-STREAM-INF:'))) {
    const variants: HlsVariant[] = [];
    lines.forEach((line, index) => {
      if (!line.startsWith('#EXT-X-STREAM-INF:')) return;
      const uri = lines[index + 1];
      if (uri === undefined || uri.startsWith('#')) return;
      const attributes = attributesOf(line.slice('#EXT-X-STREAM-INF:'.length));
      const height = /^\d+x(\d+)$/u.exec(attributes.get('RESOLUTION') ?? '')?.[1];
      variants.push({
        uri: resolve(uri),
        bandwidth: Number(attributes.get('BANDWIDTH') ?? 0) || 0,
        height: height === undefined ? null : Number(height),
      });
    });
    return { kind: 'master', variants };
  }

  let sequence = 0;
  let key: { uri: string; iv: string | undefined } | null = null;
  let ended = false;
  const segments: HlsSegment[] = [];
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      sequence = Number(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length)) || 0;
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attributes = attributesOf(line.slice('#EXT-X-KEY:'.length));
      const method = attributes.get('METHOD');
      if (method === 'NONE') key = null;
      else if (method === 'AES-128') {
        const uri = attributes.get('URI');
        if (uri === undefined) throw new HlsUnsupported('AES-128 key without URI');
        key = { uri: resolve(uri), iv: attributes.get('IV') };
      } else throw new HlsUnsupported('unsupported encryption method');
    } else if (line.startsWith('#EXT-X-BYTERANGE') || line.startsWith('#EXT-X-MAP')) {
      throw new HlsUnsupported('byte ranges and init sections are not read');
    } else if (line === '#EXT-X-ENDLIST') {
      ended = true;
    } else if (!line.startsWith('#')) {
      segments.push({
        uri: resolve(line),
        key: key === null ? null : { uri: key.uri, iv: ivOf(key.iv, sequence) },
      });
      sequence += 1;
    }
  }
  return { kind: 'media', segments, ended };
}

/**
 * The variant a description reads: the tallest at 720 lines or less (the vision reads frames at 1024 wide, ADR 0083),
 * else the smallest. `undefined` for a master without variants.
 */
export function variantForDescription(variants: readonly HlsVariant[]): HlsVariant | undefined {
  const fitting = variants
    .filter((variant) => variant.height !== null && variant.height <= 720)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || b.bandwidth - a.bandwidth);
  return fitting[0] ?? [...variants].sort((a, b) => a.bandwidth - b.bandwidth)[0];
}
