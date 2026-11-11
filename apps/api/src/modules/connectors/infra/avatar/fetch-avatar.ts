import { lookup as dnsLookup } from 'node:dns/promises';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';

import { AVATAR_MAX_BYTES, type FetchedAvatar } from '../../domain/avatar';

/** One address a name resolved to, already checked as public: the only one the request may connect to. */
interface Pinned {
  readonly address: string;
  readonly family: number;
}

type FetchLike = (url: string, init: RequestInit, pinned: Pinned) => Promise<Response>;
type Lookup = (hostname: string) => Promise<readonly { readonly address: string; readonly family: number }[]>;

/** A platform's image server that hangs is one that does not answer: the job tries again. */
const FETCH_TIMEOUT_MS = 15_000;

/** Never the agency's own network nor the machine itself: a photo comes from the public internet only. */
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv6');
}

/** `::ffff:10.0.0.1` is `10.0.0.1`. */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(address)?.[1];
  if (mapped !== undefined) return PRIVATE.check(mapped, 'ipv4');
  const family = isIP(address);
  if (family === 0) return true;
  return PRIVATE.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

const systemLookup: Lookup = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/**
 * The GET itself, connected to the address that was checked and to no other: the name is not resolved a second time,
 * so a name that answers a public address to the check and another one to the connection reaches nothing. The
 * certificate is still verified against the name (`servername`), and no redirect is followed (`node:https` never does).
 */
export function pinnedGet(url: string, init: RequestInit, pinned: Pinned): Promise<Response> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const outgoing = httpsRequest(target, {
      method: 'GET',
      headers: Object.fromEntries(new Headers(init.headers)),
      signal: init.signal ?? undefined,
      servername: isIP(target.hostname.replace(/^\[|\]$/gu, '')) === 0 ? target.hostname : undefined,
      lookup: (_hostname, options, callback) => {
        if (options.all === true) callback(null, [{ address: pinned.address, family: pinned.family }]);
        else callback(null, pinned.address, pinned.family);
      },
    });
    outgoing.once('response', (incoming: IncomingMessage) => {
      const headers = new Headers();
      for (let index = 0; index + 1 < incoming.rawHeaders.length; index += 2) {
        const [name, value] = [incoming.rawHeaders[index], incoming.rawHeaders[index + 1]];
        if (name !== undefined && value !== undefined) headers.append(name, value);
      }
      const status = incoming.statusCode ?? 0;
      const empty = status === 204 || status === 304;
      try {
        resolve(new Response(empty ? null : Readable.toWeb(incoming), { status, headers }));
        if (empty) incoming.resume();
      } catch (error) {
        incoming.destroy();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

/**
 * The image at a platform's address (CRM-07 a2b): HTTPS only, a name that resolves to public addresses only, the
 * request connected to the first of them (never resolved again, audit du 11/11), no redirect followed, `AVATAR_MAX_BYTES` at most, read as it arrives and cut beyond. The address is the platform's,
 * read from its list by the job: still, it is fetched like any address from outside.
 */
export function createAvatarFetch(
  fetchLike: FetchLike = pinnedGet,
  lookup: Lookup = systemLookup,
): (url: string) => Promise<FetchedAvatar> {
  return async (address) => {
    const url = URL.canParse(address) ? new URL(address) : null;
    if (url?.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      return { ok: false, reason: 'refused_address' };
    }
    const host = url.hostname.replace(/^\[|\]$/gu, '');
    const addresses = isIP(host) === 0 ? await lookup(host) : [{ address: host, family: isIP(host) }];
    const [first] = addresses;
    if (first === undefined || addresses.some((resolved) => isPrivateAddress(resolved.address))) {
      return { ok: false, reason: 'refused_address' };
    }
    const response = await fetchLike(
      url.toString(),
      {
        redirect: 'manual',
        headers: { accept: 'image/jpeg, image/png, image/webp' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
      { address: first.address, family: first.family },
    );
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return { ok: false, reason: 'refused_address' };
    }
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel();
      return { ok: false, reason: 'not_found' };
    }
    if (!response.ok || response.body === null) {
      await response.body?.cancel();
      throw new Error(`creator photo: the platform's image answered ${String(response.status)}`);
    }
    const announced = Number(response.headers.get('content-length') ?? Number.NaN);
    if (Number.isFinite(announced) && announced > AVATAR_MAX_BYTES) {
      await response.body.cancel();
      return { ok: false, reason: 'too_large' };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > AVATAR_MAX_BYTES) {
        await reader.cancel();
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return { ok: true, bytes };
  };
}
