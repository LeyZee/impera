import { open, stat } from 'node:fs/promises';

import { DROP_PART_BYTES, DROP_PART_URL_SECONDS, type DropMime } from '@impera/contracts';
import { AwsClient } from 'aws4fetch';

import { ContentDropStorageUnavailable } from '../../domain/errors';
import type { DropStorage } from '../../domain/ports';
import type { StoredPart } from '../../domain/upload';

import { nodeGet } from './node-get';

/** The media bucket (`S3_*`), S3-compatible: Hetzner in production, MinIO in the tests. Path-style URLs. */
export interface MediaBucketConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

type FetchLike = (request: Request) => Promise<Response>;

/** A storage that hangs is a storage that does not answer: the phone tries again, the job retries. */
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * A whole file read by the job, at a bucket in the same region (ADR 0070 § 4): a second per 10 Mo, plus a minute.
 * A 10 Gio video has about twenty minutes.
 */
const downloadTimeoutMs = (bytes: number): number => 60_000 + Math.ceil(bytes / 10_000_000) * 1000;
/** A file up to this size goes up in one PUT; above, in parts of `DROP_PART_BYTES`, read one at a time. */
const SINGLE_PUT_BYTES = 2 * DROP_PART_BYTES;

/** The provider's error code (`<Code>NoSuchUpload</Code>`), never its whole body. */
async function errorCodeOf(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  return /<Code>([^<]{1,64})<\/Code>/u.exec(body)?.[1] ?? 'no code';
}

/**
 * The text of the first `<name>` of an XML fragment, its entities read back, named or numeric (MinIO writes the quotes
 * of an ETag as `&#34;`, CI 03/11); `null` when absent.
 */
export function xmlText(fragment: string, name: string): string | null {
  const found = new RegExp(`<${name}>([^<]*)</${name}>`, 'u').exec(fragment)?.[1];
  if (found === undefined) return null;
  const named: Readonly<Record<string, string>> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
  return found.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (entity, body: string) => {
    if (!body.startsWith('#')) return named[body] ?? entity;
    const hex = body.startsWith('#x') || body.startsWith('#X');
    const point = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    // Past the last code point, fromCodePoint throws (Bilan on #512): such an entity stays as written.
    return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

const xmlEscape = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/**
 * The drops' storage over S3's multipart upload: the server starts, lists and completes each upload with its own key;
 * the phone sends each part to an address signed for that part and its exact size (`content-length` is signed), so
 * that a part can neither grow nor go elsewhere. The bucket's CORS lets the web origin PUT and read `ETag`
 * (runbook deploy.md § Stockage des médias).
 */
export function createS3DropStorage(config: MediaBucketConfig, fetchLike?: FetchLike): DropStorage {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: config.region,
  });
  const send = fetchLike ?? ((request: Request) => fetch(request));
  // An object's body over `node:http` (MED-04): read slowly by the archive, never through undici's parser.
  const get = fetchLike ?? nodeGet;
  const bucketUrl = `${config.endpoint.replace(/\/+$/u, '')}/${encodeURIComponent(config.bucket)}`;
  const urlOf = (key: string, query = ''): string =>
    `${bucketUrl}/${key.split('/').map(encodeURIComponent).join('/')}${query === '' ? '' : `?${query}`}`;

  const call = async (
    what: string,
    url: string,
    init: RequestInit,
    timeout: number | AbortSignal = REQUEST_TIMEOUT_MS,
  ): Promise<Response> => {
    const signal = typeof timeout === 'number' ? AbortSignal.timeout(timeout) : timeout;
    try {
      const request = new Request(await client.sign(url, init), { signal });
      return await (request.method === 'GET' ? get(request) : send(request));
    } catch (error) {
      throw new ContentDropStorageUnavailable(`${config.bucket}: no answer to ${what}`, { cause: error });
    }
  };
  const refused = async (what: string, response: Response): Promise<never> => {
    throw new ContentDropStorageUnavailable(
      `${config.bucket}: ${what} answered ${String(response.status)} (${await errorCodeOf(response)})`,
    );
  };
  const textOf = async (what: string, response: Response): Promise<string> => {
    try {
      return await response.text();
    } catch (error) {
      throw new ContentDropStorageUnavailable(`${config.bucket}: ${what} cut off`, { cause: error });
    }
  };

  const storage: DropStorage = {
    async openUpload(key) {
      const what = `the uploads of ${key}`;
      const response = await call(what, `${bucketUrl}?uploads&prefix=${encodeURIComponent(key)}`, {
        method: 'GET',
      });
      if (!response.ok) return refused(what, response);
      const body = await textOf(what, response);
      const uploads = [...body.matchAll(/<Upload>([\s\S]*?)<\/Upload>/gu)]
        .map(([, block]) => block ?? '')
        .filter((block) => xmlText(block, 'Key') === key)
        .map((block) => ({ id: xmlText(block, 'UploadId'), at: xmlText(block, 'Initiated') ?? '' }))
        .filter((upload): upload is { id: string; at: string } => upload.id !== null)
        .sort((a, b) => a.at.localeCompare(b.at));
      return uploads[0]?.id ?? null;
    },

    async startUpload(key, mime: DropMime) {
      const what = `the start of ${key}`;
      const response = await call(what, urlOf(key, 'uploads'), {
        method: 'POST',
        headers: { 'content-type': mime },
      });
      if (!response.ok) return refused(what, response);
      const id = xmlText(await textOf(what, response), 'UploadId');
      if (id === null) throw new ContentDropStorageUnavailable(`${config.bucket}: ${what} gave no upload id`);
      return id;
    },

    async storedParts(key, uploadId) {
      const parts: StoredPart[] = [];
      // At most 63 parts a file (`DROP_PART_BYTES`): one page of 1 000 holds them, the marker reads further anyway.
      for (let marker = '0'; ;) {
        const what = `the parts of ${key}`;
        const response = await call(
          what,
          urlOf(key, `uploadId=${encodeURIComponent(uploadId)}&part-number-marker=${marker}`),
          { method: 'GET' },
        );
        // Aborted by the storage's rule, or completed meanwhile: no part held.
        if (response.status === 404) {
          await response.body?.cancel();
          return [];
        }
        if (!response.ok) return refused(what, response);
        const body = await textOf(what, response);
        for (const [, block] of body.matchAll(/<Part>([\s\S]*?)<\/Part>/gu)) {
          const number = Number(xmlText(block ?? '', 'PartNumber'));
          const etag = xmlText(block ?? '', 'ETag');
          const bytes = Number(xmlText(block ?? '', 'Size'));
          if (Number.isInteger(number) && etag !== null && Number.isInteger(bytes))
            parts.push({ number, etag, bytes });
        }
        const next = xmlText(body, 'NextPartNumberMarker');
        if (xmlText(body, 'IsTruncated') !== 'true' || next === null || next === marker) return parts;
        marker = next;
      }
    },

    async partUrl(key, uploadId, number, bytes) {
      const url = new URL(
        urlOf(key, `partNumber=${String(number)}&uploadId=${encodeURIComponent(uploadId)}`),
      );
      url.searchParams.set('X-Amz-Expires', String(DROP_PART_URL_SECONDS));
      const signed = await client.sign(url.toString(), {
        method: 'PUT',
        headers: { 'content-length': String(bytes) },
        aws: { signQuery: true, allHeaders: true },
      });
      return signed.url;
    },

    async completeUpload(key, uploadId, parts) {
      const what = `the completion of ${key}`;
      const body = `<CompleteMultipartUpload>${[...parts]
        .sort((a, b) => a.number - b.number)
        .map(
          (part) =>
            `<Part><PartNumber>${String(part.number)}</PartNumber><ETag>${xmlEscape(part.etag)}</ETag></Part>`,
        )
        .join('')}</CompleteMultipartUpload>`;
      const response = await call(what, urlOf(key, `uploadId=${encodeURIComponent(uploadId)}`), {
        method: 'POST',
        headers: { 'content-type': 'application/xml' },
        body,
      });
      if (response.status === 400 || response.status === 404) {
        await response.body?.cancel();
        return 'refused';
      }
      if (!response.ok) return refused(what, response);
      // S3 may answer 200 with an error in the body, after a long completion.
      const answer = await textOf(what, response);
      return answer.includes('<Error>') ? 'refused' : 'completed';
    },

    async sizeOf(key) {
      const what = `HEAD ${key}`;
      const response = await call(what, urlOf(key), { method: 'HEAD' });
      if (response.status === 404) return null;
      if (!response.ok) return refused(what, response);
      // No length is no answer, never a size of 0 (Bilan on #512): the file would be erased as the wrong size.
      const header = response.headers.get('content-length');
      const length = header === null || !/^\d+$/u.test(header) ? Number.NaN : Number(header);
      if (!Number.isInteger(length)) {
        throw new ContentDropStorageUnavailable(`${config.bucket}: ${what} gave no size`);
      }
      return length;
    },

    async download(key, path, bytes) {
      const what = `GET ${key}`;
      const response = await call(what, urlOf(key), { method: 'GET' }, downloadTimeoutMs(bytes));
      if (response.status === 404) {
        await response.body?.cancel();
        return false;
      }
      if (!response.ok || response.body === null) return refused(what, response);
      const out = await open(path, 'w');
      try {
        const reader = response.body.getReader();
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
          await out.write(chunk.value);
        }
      } catch (error) {
        throw new ContentDropStorageUnavailable(`${config.bucket}: ${what} cut off`, { cause: error });
      } finally {
        await out.close();
      }
      return true;
    },

    async read(key, range) {
      const what =
        range === undefined ? `GET ${key}` : `GET ${key} ${String(range.start)}-${String(range.end)}`;
      // A stall of the storage aborts the read, never a slow reader: the clock runs only while a chunk is awaited
      // (relecture Bilan de #607), the archive's client may take its time between two.
      const abort = new AbortController();
      let stalled = setTimeout(() => {
        abort.abort();
      }, REQUEST_TIMEOUT_MS);
      const init: RequestInit =
        range === undefined
          ? { method: 'GET' }
          : { method: 'GET', headers: { range: `bytes=${String(range.start)}-${String(range.end)}` } };
      const response = await call(what, urlOf(key), init, abort.signal).finally(() => {
        clearTimeout(stalled);
      });
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok || response.body === null) return refused(what, response);
      const reader = response.body.getReader();
      return (async function* chunks(): AsyncGenerator<Uint8Array> {
        let done = false;
        try {
          for (;;) {
            stalled = setTimeout(() => {
              abort.abort();
            }, REQUEST_TIMEOUT_MS);
            const chunk = await reader.read().finally(() => {
              clearTimeout(stalled);
            });
            if (chunk.done) break;
            yield chunk.value;
          }
          done = true;
        } catch (error) {
          throw new ContentDropStorageUnavailable(`${config.bucket}: ${what} cut off`, { cause: error });
        } finally {
          // The archive stopped before the end (its client went away, or another medium failed): the connection to
          // the storage is closed now, not left open until a timeout.
          if (!done) await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      })();
    },

    async upload(key, path, mime, sha256) {
      const size = (await stat(path)).size;
      const file = await open(path, 'r');
      try {
        const read = async (from: number, length: number): Promise<Uint8Array> => {
          const buffer = new Uint8Array(length);
          const { bytesRead } = await file.read(buffer, 0, length, from);
          if (bytesRead !== length)
            throw new Error(`${path}: ${String(bytesRead)} bytes read of ${String(length)}`);
          return buffer;
        };
        if (size <= SINGLE_PUT_BYTES) {
          const what = `PUT ${key}`;
          const response = await call(what, urlOf(key), {
            method: 'PUT',
            body: await read(0, size),
            headers: { 'content-type': mime, 'x-amz-content-sha256': sha256 },
          });
          await response.body?.cancel();
          if (!response.ok) return await refused(what, response);
          return;
        }
        const uploadId = await storage.startUpload(key, mime);
        try {
          const parts: { number: number; etag: string }[] = [];
          for (let number = 1; (number - 1) * DROP_PART_BYTES < size; number += 1) {
            const from = (number - 1) * DROP_PART_BYTES;
            const what = `part ${String(number)} of ${key}`;
            const response = await call(
              what,
              urlOf(key, `partNumber=${String(number)}&uploadId=${encodeURIComponent(uploadId)}`),
              { method: 'PUT', body: await read(from, Math.min(DROP_PART_BYTES, size - from)) },
            );
            await response.body?.cancel();
            const etag = response.headers.get('etag');
            if (!response.ok || etag === null) return await refused(what, response);
            parts.push({ number, etag });
          }
          if ((await storage.completeUpload(key, uploadId, parts)) === 'refused') {
            throw new ContentDropStorageUnavailable(`${config.bucket}: the parts of ${key} were refused`);
          }
        } catch (error) {
          // Never a send left open under media/ (Bilan on #516): its parts would be kept, and billed, for ever. The
          // abort is best effort, the bucket's rule on unfinished sends (runbook § 4.4) is the net; the job retries.
          const abort = await call(`abort ${key}`, urlOf(key, `uploadId=${encodeURIComponent(uploadId)}`), {
            method: 'DELETE',
          }).catch(() => null);
          await abort?.body?.cancel();
          throw error;
        }
      } finally {
        await file.close();
      }
    },

    async remove(key) {
      const what = `DELETE ${key}`;
      const response = await call(what, urlOf(key), { method: 'DELETE' });
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) return refused(what, response);
    },
  };
  return storage;
}
