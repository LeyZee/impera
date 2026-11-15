import { createDecipheriv } from 'node:crypto';
import { open } from 'node:fs/promises';

import { HlsUnsupported, parseHlsPlaylist, variantForDescription } from './hls-playlist';

/**
 * `fetch`, narrowed to what a download uses, so a test can hand FakeReveal over. Nothing but the URL and the abort
 * signal is passed: no cookie, no token, no header of the session ever goes with a file link.
 */
export type FileFetch = (
  url: string,
  init: { readonly method: 'GET'; readonly signal: AbortSignal; readonly redirect: 'error' },
) => Promise<{
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** Why no file: the link is no longer signed (`expired`), the media is gone, or the download broke a bound. */
export type VaultFileFailure = 'expired' | 'gone' | 'too_large' | 'host_refused' | 'unsupported' | 'failed';

export class VaultFileError extends Error {
  override readonly name = 'VaultFileError';
  constructor(readonly reason: VaultFileFailure) {
    super(`vault file: ${reason}`);
  }
}

export interface DownloadBounds {
  /** The hosts a file link may name, exact or as a parent domain (`cdn.example` lets `a.cdn.example`). */
  readonly hosts: readonly string[];
  readonly maxBytes: number;
  /** For the whole file, playlist, key and segments together. */
  readonly timeoutMs: number;
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
/** A playlist or a key is small: anything bigger is not one. */
const TEXT_MAX_BYTES = 1024 * 1024;

function allowed(url: string, hosts: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  const host = parsed.hostname.toLowerCase();
  return hosts.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`));
}

/**
 * Downloads one file of the vault to `path` (ADR 0030 § 4, ADR 0099 § 5, ADR 0113): a photo in one GET, a video's HLS
 * playlist resolved to one variant, its AES-128 segments fetched, decrypted and written one after the other into a
 * single MPEG-TS file. Every URL, the playlist's own included, must be on a host of `bounds.hosts`; the bytes stop at
 * `bounds.maxBytes`, the whole at `bounds.timeoutMs`. The file at `path` is the caller's to remove, failed or not.
 */
export async function downloadVaultFile(
  fetch: FileFetch,
  link: VaultFileLink,
  path: string,
  bounds: DownloadBounds,
): Promise<DownloadedFile> {
  const signal = AbortSignal.timeout(bounds.timeoutMs);
  let written = 0;

  const get = async (url: string, limit: number): Promise<{ body: Buffer; type: string | null }> => {
    if (!allowed(url, bounds.hosts)) throw new VaultFileError('host_refused');
    let response: Awaited<ReturnType<FileFetch>>;
    try {
      response = await fetch(url, { method: 'GET', signal, redirect: 'error' });
    } catch {
      throw new VaultFileError('failed');
    }
    if (response.status === 401 || response.status === 403) throw new VaultFileError('expired');
    if (response.status === 404 || response.status === 410) throw new VaultFileError('gone');
    if (response.status !== 200) throw new VaultFileError('failed');
    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > limit) throw new VaultFileError('too_large');
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > limit) throw new VaultFileError('too_large');
    return { body, type: response.headers.get('content-type') };
  };

  const file = await open(path, 'w');
  try {
    if (!link.isHls) {
      const { body, type } = await get(link.url, bounds.maxBytes);
      await file.write(body);
      return { bytes: body.byteLength, contentType: type };
    }

    let playlistUrl = link.url;
    let playlist = parseHlsPlaylist(
      (await get(playlistUrl, TEXT_MAX_BYTES)).body.toString('utf8'),
      playlistUrl,
    );
    if (playlist.kind === 'master') {
      const variant = variantForDescription(playlist.variants);
      if (variant === undefined) throw new VaultFileError('unsupported');
      playlistUrl = variant.uri;
      playlist = parseHlsPlaylist(
        (await get(playlistUrl, TEXT_MAX_BYTES)).body.toString('utf8'),
        playlistUrl,
      );
      if (playlist.kind === 'master') throw new VaultFileError('unsupported');
    }
    // A live stream has no end: the vault serves a finished file, anything else is not one.
    if (!playlist.ended || playlist.segments.length === 0) throw new VaultFileError('unsupported');

    const keys = new Map<string, Buffer>();
    for (const segment of playlist.segments) {
      let { body } = await get(segment.uri, bounds.maxBytes - written);
      if (segment.key !== null) {
        let key = keys.get(segment.key.uri);
        if (key === undefined) {
          key = (await get(segment.key.uri, KEY_BYTES)).body;
          if (key.byteLength !== KEY_BYTES) throw new VaultFileError('unsupported');
          keys.set(segment.key.uri, key);
        }
        try {
          const decipher = createDecipheriv('aes-128-cbc', key, segment.key.iv);
          body = Buffer.concat([decipher.update(body), decipher.final()]);
        } catch {
          throw new VaultFileError('unsupported');
        }
      }
      written += body.byteLength;
      if (written > bounds.maxBytes) throw new VaultFileError('too_large');
      await file.write(body);
    }
    return { bytes: written, contentType: 'video/mp2t' };
  } catch (error) {
    if (error instanceof HlsUnsupported) throw new VaultFileError('unsupported');
    if (error instanceof VaultFileError) throw error;
    if (signal.aborted) throw new VaultFileError('failed');
    throw error;
  } finally {
    await file.close();
  }
}
