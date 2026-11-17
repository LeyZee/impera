import { createDecipheriv } from 'node:crypto';
import { open, rm, type FileHandle } from 'node:fs/promises';
import { isIP } from 'node:net';

import { isPrivateAddress, pinnedGet, systemLookup, type Lookup, type Pinned } from '../avatar/fetch-avatar';

import { HlsUnsupported, parseHlsPlaylist, variantForDescription } from './hls-playlist';

/**
 * How a vault file is reached (ADR 0113 § 2): the host resolved, then one GET connected to the address that was checked
 * and to no other, with no header (never the session's client, its token nor a cookie) but `Referer` to the one host of
 * `DownloadBounds.referer`, and no redirect followed. A test hands FakeReveal over in its place.
 */
export interface FileTransport {
  readonly lookup: Lookup;
  readonly get: (
    url: string,
    signal: AbortSignal,
    pinned: Pinned,
    headers?: Readonly<Record<string, string>>,
  ) => Promise<Response>;
}

export const SYSTEM_FILE_TRANSPORT: FileTransport = {
  lookup: systemLookup,
  get: (url, signal, pinned, headers) =>
    pinnedGet(url, { signal, ...(headers === undefined ? {} : { headers }) }, pinned),
};

/** Why no file: the link is no longer signed (`expired`), the media is gone, or the download broke a bound. */
export type VaultFileFailure = 'expired' | 'gone' | 'too_large' | 'host_refused' | 'unsupported' | 'failed';

export class VaultFileError extends Error {
  override readonly name = 'VaultFileError';
  constructor(readonly reason: VaultFileFailure) {
    super(`vault file: ${reason}`);
  }
}

export interface DownloadBounds {
  /** The hosts a file link may name, exact, or as a parent domain (`cdn.example` lets `a.cdn.example`). */
  readonly hosts: readonly string[];
  /** The bytes read in all, playlists, keys and segments together. */
  readonly maxBytes: number;
  /** For the whole file. */
  readonly timeoutMs: number;
  readonly maxSegments: number;
  readonly maxKeys: number;
  /** FakeReveal's links only, in the tests: a real link is HTTPS on its default port. */
  readonly allowHttp?: boolean;
  /**
   * The one host that expects the dashboard's origin header (ADR 0113 § 2, amendment of 16/11), named in full and also
   * in `hosts`, and that fixed value: sent to that host over HTTPS only, to no other host and with no other header.
   */
  readonly referer?: { readonly host: string; readonly value: string };
}

/** A link of the vault as the platform gives it: a file, or an HLS playlist. */
export interface VaultFileLink {
  readonly url: string;
  readonly isHls: boolean;
}

export interface DownloadedFile {
  readonly bytes: number;
  /** As the server said it; the caller reads the true type from the bytes. HLS: `video/mp2t`. */
  readonly contentType: string | null;
}

const KEY_BYTES = 16;
/** A playlist is small: anything bigger is not one. */
const PLAYLIST_MAX_BYTES = 1024 * 1024;

function hostAllowed(url: string, bounds: DownloadBounds): string | null {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  const secure = parsed.protocol === 'https:' && (parsed.port === '' || parsed.port === '443');
  const test = bounds.allowHttp === true && parsed.protocol === 'http:' && parsed.port === '';
  if (!secure && !test) return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  const host = parsed.hostname.toLowerCase();
  // An address written as such is never one of the platform's file hosts.
  if (isIP(host.replace(/^\[|\]$/gu, '')) !== 0) return null;
  // Named in full (ADR 0113 § 2): a subdomain of a listed host is another host.
  return bounds.hosts.includes(host) ? host : null;
}

/**
 * One GET of a file link, checked (ADR 0113 § 2): HTTPS on a host of `bounds.hosts` named in full, resolving to public
 * addresses only, connected to the address checked, no header sent but `Referer` to the one host of `bounds.referer`
 * (ADR 0113 § 2, amendment of 16/11), no redirect followed. `read`: the bytes already read by the caller, against
 * `bounds.maxBytes`.
 */
async function openChecked(
  transport: FileTransport,
  url: string,
  bounds: DownloadBounds,
  signal: AbortSignal,
  read: number,
): Promise<Response> {
  const host = hostAllowed(url, bounds);
  if (host === null) throw new VaultFileError('host_refused');
  let response: Response;
  try {
    const addresses = await transport.lookup(host);
    const [first] = addresses;
    if (first === undefined || addresses.some((resolved) => isPrivateAddress(resolved.address))) {
      throw new VaultFileError('host_refused');
    }
    const pinned = { address: first.address, family: first.family };
    const referer =
      bounds.referer?.host === host && new URL(url).protocol === 'https:' ? bounds.referer.value : null;
    response =
      referer === null
        ? await transport.get(url, signal, pinned)
        : await transport.get(url, signal, pinned, { referer });
  } catch (error) {
    if (error instanceof VaultFileError) throw error;
    throw new VaultFileError('failed');
  }
  const refused = (reason: VaultFileFailure): Promise<never> =>
    (response.body?.cancel() ?? Promise.resolve()).then(() => {
      throw new VaultFileError(reason);
    });
  if (response.status === 401 || response.status === 403) return refused('expired');
  if (response.status === 404 || response.status === 410) return refused('gone');
  if (response.status !== 200 || response.body === null) return refused('failed');
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && read + declared > bounds.maxBytes) return refused('too_large');
  return response;
}

/**
 * Downloads one file of the vault to `path` (ADR 0030 § 4, ADR 0099 § 5, ADR 0113): a photo in one GET, a video's HLS
 * playlist resolved to one variant, its AES-128 segments fetched, decrypted and written one after the other into a
 * single MPEG-TS file. Every URL, the playlist's own included, must be HTTPS on a host of `bounds.hosts` that resolves
 * to public addresses only; every body is read as it arrives, counted and cut at `bounds.maxBytes`. `path` is a fixed
 * name in a directory the caller made for this file alone (`mkdtemp`), created here (`wx`, 0600) and removed here when
 * the download fails; the caller removes the directory, failed or not.
 */
export async function downloadVaultFile(
  transport: FileTransport,
  link: VaultFileLink,
  path: string,
  bounds: DownloadBounds,
): Promise<DownloadedFile> {
  const signal = AbortSignal.timeout(bounds.timeoutMs);
  let read = 0;

  const request = (url: string): Promise<Response> => openChecked(transport, url, bounds, signal, read);

  /** The body, chunk by chunk as it arrives, counted against the bound before anything is kept. */
  const each = async (response: Response, limit: number, take: (chunk: Uint8Array) => Promise<void>) => {
    if (response.body === null) throw new VaultFileError('failed');
    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
    let own = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        own += value.byteLength;
        read += value.byteLength;
        if (own > limit || read > bounds.maxBytes) throw new VaultFileError('too_large');
        await take(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (error instanceof VaultFileError) throw error;
      throw new VaultFileError('failed');
    }
  };

  const small = async (url: string, limit: number): Promise<Buffer> => {
    const chunks: Uint8Array[] = [];
    await each(await request(url), limit, (chunk) => {
      chunks.push(chunk);
      return Promise.resolve();
    });
    return Buffer.concat(chunks);
  };

  let file: FileHandle | null = null;
  let complete = false;
  try {
    file = await open(path, 'wx', 0o600);
    const out = file;
    const write = async (chunk: Uint8Array): Promise<void> => {
      await out.write(chunk);
    };

    if (!link.isHls) {
      const response = await request(link.url);
      const contentType = response.headers.get('content-type');
      await each(response, bounds.maxBytes, write);
      complete = true;
      return { bytes: read, contentType };
    }

    let playlistUrl = link.url;
    let playlist = parseHlsPlaylist(
      (await small(playlistUrl, PLAYLIST_MAX_BYTES)).toString('utf8'),
      playlistUrl,
    );
    if (playlist.kind === 'master') {
      const variant = variantForDescription(playlist.variants);
      if (variant === undefined) throw new VaultFileError('unsupported');
      playlistUrl = variant.uri;
      playlist = parseHlsPlaylist(
        (await small(playlistUrl, PLAYLIST_MAX_BYTES)).toString('utf8'),
        playlistUrl,
      );
      if (playlist.kind === 'master') throw new VaultFileError('unsupported');
    }
    // A live stream has no end: the vault serves a finished file, anything else is not one.
    if (!playlist.ended || playlist.segments.length === 0) throw new VaultFileError('unsupported');
    if (playlist.segments.length > bounds.maxSegments) throw new VaultFileError('too_large');

    const keys = new Map<string, Buffer>();
    let written = 0;
    for (const segment of playlist.segments) {
      let key: Buffer | undefined;
      if (segment.key !== null) {
        key = keys.get(segment.key.uri);
        if (key === undefined) {
          if (keys.size >= bounds.maxKeys) throw new VaultFileError('unsupported');
          key = await small(segment.key.uri, KEY_BYTES);
          if (key.byteLength !== KEY_BYTES) throw new VaultFileError('unsupported');
          keys.set(segment.key.uri, key);
        }
      }
      const response = await request(segment.uri);
      if (key === undefined || segment.key === null) {
        await each(response, bounds.maxBytes, async (chunk) => {
          written += chunk.byteLength;
          await write(chunk);
        });
        continue;
      }
      const decipher = createDecipheriv('aes-128-cbc', key, segment.key.iv);
      await each(response, bounds.maxBytes, async (chunk) => {
        const plain = decipher.update(chunk);
        written += plain.byteLength;
        await write(plain);
      });
      let last: Buffer;
      try {
        last = decipher.final();
      } catch {
        throw new VaultFileError('unsupported');
      }
      written += last.byteLength;
      await write(last);
    }
    complete = true;
    return { bytes: written, contentType: 'video/mp2t' };
  } catch (error) {
    if (error instanceof HlsUnsupported) throw new VaultFileError('unsupported');
    if (error instanceof VaultFileError) throw error;
    if (signal.aborted) throw new VaultFileError('failed');
    throw error;
  } finally {
    await file?.close();
    // Only the file this call created: `wx` refused an existing one before `file` was set.
    if (file !== null && !complete) await rm(path, { force: true });
  }
}

/**
 * One small picture of the vault, in memory and never written (ADR 0138 §§ 1-2): the same hosts, transport and checks as
 * a file (ADR 0113 § 2), one GET, its body cut at `bounds.maxBytes`. The caller reads the type from the bytes.
 */
export async function readVaultPicture(
  transport: FileTransport,
  url: string,
  bounds: DownloadBounds,
): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(bounds.timeoutMs);
  const response = await openChecked(transport, url, bounds, signal, 0);
  if (response.body === null) throw new VaultFileError('failed');
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks);
      read += value.byteLength;
      if (read > bounds.maxBytes) throw new VaultFileError('too_large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof VaultFileError) throw error;
    throw new VaultFileError('failed');
  }
}
