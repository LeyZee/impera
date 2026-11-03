import { createHash } from 'node:crypto';

import { AwsClient } from 'aws4fetch';

import { InvoiceStorageRefused, InvoiceStorageUnavailable } from '../domain/errors';
import type { InvoiceObjectStore, StoredObject } from '../domain/ports';

/**
 * The two buckets of invoices (ADR 0037 § 4 and § 6), S3-compatible: Hetzner for the PDFs, OVHcloud for their copy;
 * the first one keeps the contractors' documents too, under their own prefix (EQ-06 lot 5c).
 * Each object goes up signed with its SHA-256, which the bucket checks (a file damaged on the way is refused), under a
 * compliance lock until its own date, and with `If-None-Match: *`: a key that holds an object is never written again.
 * Path-style URLs (`<endpoint>/<bucket>/<key>`), which both providers and MinIO serve.
 */
export interface S3BucketConfig {
  /** `https://fsn1.your-objectstorage.com`, `https://s3.gra.io.cloud.ovh.net`: the provider's endpoint, no bucket. */
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/** What the store reaches the bucket with; the global `fetch` unless a test gives another. */
type FetchLike = (request: Request) => Promise<Response>;

/** A bucket that hangs is a bucket that does not answer: the job retries, the download reads the copy. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Whether `fetch` failed because the bucket had closed the kept-alive connection the request went out on, before any
 * answer (undici's `UND_ERR_SOCKET`, or a reset). MinIO closes it right after answering 412 to a conditional PUT,
 * without `Connection: close`: the next request can leave on it before Node has seen the close (CI, 03/11).
 */
function closedByBucket(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const cause: unknown = error.cause;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause.code === 'UND_ERR_SOCKET' || cause.code === 'ECONNRESET')
  );
}

const base64Of = (algorithm: 'md5' | 'sha256', bytes: Uint8Array): string =>
  createHash(algorithm).update(bytes).digest('base64');

/** The provider's error code (`<Code>AccessDenied</Code>`), never its whole body, for the log and the error. */
async function errorCodeOf(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  return /<Code>([^<]{1,64})<\/Code>/u.exec(body)?.[1] ?? 'no code';
}

/** The text of the first `<name>` of an XML fragment, its five entities read back; `null` when absent. */
function xmlText(fragment: string, name: string): string | null {
  const found = new RegExp(`<${name}>([^<]*)</${name}>`, 'u').exec(fragment)?.[1];
  if (found === undefined) return null;
  return found
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/**
 * Whether the lock an answer names still holds, in either mode: an unreadable date is taken for one that holds, so
 * nothing is ever erased on a guess.
 */
function lockHolds(headers: Headers): boolean {
  const lock = headers.get('x-amz-object-lock-retain-until-date');
  if (lock === null) return false;
  const until = new Date(lock);
  return Number.isNaN(until.getTime()) || until.getTime() > Date.now();
}

export function createS3InvoiceStore(config: S3BucketConfig, fetchLike?: FetchLike): InvoiceObjectStore {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: config.region,
  });
  const send = fetchLike ?? ((request: Request) => fetch(request));
  const urlOf = (key: string): string =>
    `${config.endpoint.replace(/\/+$/u, '')}/${encodeURIComponent(config.bucket)}/${key
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  /**
   * Signed and sent, with its own timeout. A read (GET, HEAD) that met a connection the bucket had closed goes again
   * once, on a new one: it changes nothing. A write never does: a PUT sent twice could answer 412 to its own object.
   */
  const fetchSigned = async (url: string, init: RequestInit): Promise<Response> => {
    const attempt = async (): Promise<Response> =>
      send(new Request(await client.sign(url, init), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }));
    try {
      return await attempt();
    } catch (error) {
      const method = init.method ?? 'GET';
      if ((method === 'GET' || method === 'HEAD') && closedByBucket(error)) return attempt();
      throw error;
    }
  };
  /** `query`: a subresource of the object (`retention`), signed with it. */
  const call = async (key: string, init: RequestInit, query = ''): Promise<Response> => {
    try {
      return await fetchSigned(query === '' ? urlOf(key) : `${urlOf(key)}?${query}`, init);
    } catch (error) {
      throw new InvoiceStorageUnavailable(`${config.bucket}: no answer for ${key}`, { cause: error });
    }
  };
  /**
   * ListObjectVersions on the exact key (`prefix`, then only the keys equal to it): the ids of its versions and of
   * the delete markers over them. A marker makes a HEAD answer 404 while the bytes stay: only the listing sees them.
   */
  const versionsOf = async (
    key: string,
  ): Promise<{ readonly versions: string[]; readonly markers: string[] }> => {
    const url = `${config.endpoint.replace(/\/+$/u, '')}/${encodeURIComponent(config.bucket)}?versions&prefix=${encodeURIComponent(key)}`;
    let response: Response;
    try {
      response = await fetchSigned(url, { method: 'GET' });
    } catch (error) {
      throw new InvoiceStorageUnavailable(`${config.bucket}: no answer for the versions of ${key}`, {
        cause: error,
      });
    }
    if (!response.ok) {
      throw new InvoiceStorageUnavailable(
        `${config.bucket}: GET ?versions of ${key} answered ${String(response.status)} (${await errorCodeOf(response)})`,
      );
    }
    const body = await response.text();
    if (body.includes('<IsTruncated>true</IsTruncated>')) {
      throw new InvoiceStorageUnavailable(`${config.bucket}: the versions of ${key} do not fit one answer`);
    }
    const versions: string[] = [];
    const markers: string[] = [];
    for (const [, kind, block] of body.matchAll(/<(Version|DeleteMarker)>([\s\S]*?)<\/\1>/gu)) {
      if (block === undefined || xmlText(block, 'Key') !== key) continue;
      const id = xmlText(block, 'VersionId');
      if (id === null) throw new InvoiceStorageUnavailable(`${config.bucket}: a version of ${key} has no id`);
      (kind === 'Version' ? versions : markers).push(id);
    }
    return { versions, markers };
  };
  return {
    volatile: false,
    async writeOnce(key, bytes, sha256, retainUntil, mediaType = 'application/pdf') {
      if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
        throw new Error(`The SHA-256 given for ${key} is not that of its bytes`);
      }
      const response = await call(key, {
        method: 'PUT',
        body: bytes,
        headers: {
          'content-type': mediaType,
          // The payload is signed with its hash, and the bucket checks both sums of the bytes it receives.
          'x-amz-content-sha256': sha256,
          'x-amz-checksum-sha256': base64Of('sha256', bytes),
          'content-md5': base64Of('md5', bytes),
          'x-amz-object-lock-mode': 'COMPLIANCE',
          'x-amz-object-lock-retain-until-date': retainUntil.toISOString(),
          'if-none-match': '*',
        },
      });
      if (response.status === 412) {
        await response.body?.cancel();
        return 'exists';
      }
      if (!response.ok) {
        throw new InvoiceStorageUnavailable(
          `${config.bucket}: PUT ${key} answered ${String(response.status)} (${await errorCodeOf(response)})`,
        );
      }
      await response.body?.cancel();
      return 'written';
    },
    async read(key): Promise<StoredObject | null> {
      const response = await call(key, { method: 'GET' });
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) {
        throw new InvoiceStorageUnavailable(
          `${config.bucket}: GET ${key} answered ${String(response.status)} (${await errorCodeOf(response)})`,
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        throw new InvoiceStorageUnavailable(`${config.bucket}: GET ${key} cut off`, { cause: error });
      }
      const lock = response.headers.get('x-amz-object-lock-retain-until-date');
      const mode = response.headers.get('x-amz-object-lock-mode');
      const retainUntil = lock === null || mode !== 'COMPLIANCE' ? null : new Date(lock);
      return {
        bytes,
        retainUntil: retainUntil === null || Number.isNaN(retainUntil.getTime()) ? null : retainUntil,
      };
    },
    async lengthenLock(key, retainUntil) {
      // PutObjectRetention on the object's current version: the bucket refuses a date earlier than its lock.
      const retention = `<Retention xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Mode>COMPLIANCE</Mode><RetainUntilDate>${retainUntil.toISOString()}</RetainUntilDate></Retention>`;
      const body = new TextEncoder().encode(retention);
      const response = await call(
        key,
        {
          method: 'PUT',
          body,
          headers: {
            'content-type': 'application/xml',
            'content-md5': base64Of('md5', body),
            'x-amz-content-sha256': createHash('sha256').update(body).digest('hex'),
          },
        },
        'retention',
      );
      if (!response.ok) {
        throw new InvoiceStorageUnavailable(
          `${config.bucket}: PUT ${key}?retention answered ${String(response.status)} (${await errorCodeOf(response)})`,
        );
      }
      await response.body?.cancel();
    },
    async remove(key, sha256) {
      const listed = await versionsOf(key);
      if (listed.versions.length === 0 && listed.markers.length === 0) return 'absent';
      // Each version first read, nothing erased yet: its bytes must be the file the row names, its lock ended.
      for (const version of listed.versions) {
        const response = await call(key, { method: 'GET' }, `versionId=${encodeURIComponent(version)}`);
        if (!response.ok) {
          throw new InvoiceStorageUnavailable(
            `${config.bucket}: GET ${key}?versionId answered ${String(response.status)} (${await errorCodeOf(response)})`,
          );
        }
        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(await response.arrayBuffer());
        } catch (error) {
          throw new InvoiceStorageUnavailable(`${config.bucket}: GET ${key}?versionId cut off`, {
            cause: error,
          });
        }
        if (createHash('sha256').update(bytes).digest('hex') !== sha256) return 'altered';
        if (lockHolds(response.headers)) return 'locked';
      }
      // Then erased by their ids, the versions before the markers that hid them.
      const markers = new Set(listed.markers);
      for (const version of [...listed.versions, ...listed.markers]) {
        const response = await call(key, { method: 'DELETE' }, `versionId=${encodeURIComponent(version)}`);
        // A lock refuses with 403 AccessDenied (AWS) or 400 « Object is WORM protected » (MinIO). The read above has
        // just found it over: « not yet » only if the version, read again, names a lock lengthened since (the next
        // run tries again). Otherwise, or for a marker, which has no lock, the key lacks a right (Bilan on #359).
        if (response.status === 403 || response.status === 400) {
          const body = await response.text().catch(() => '');
          const code = /<Code>([^<]{1,64})<\/Code>/u.exec(body)?.[1] ?? 'no code';
          if (response.status === 400 && !/WORM protected|ObjectLocked/u.test(body)) {
            throw new InvoiceStorageUnavailable(
              `${config.bucket}: DELETE ${key}?versionId answered 400 (${code})`,
            );
          }
          if (!markers.has(version)) {
            const again = await call(key, { method: 'HEAD' }, `versionId=${encodeURIComponent(version)}`);
            if (!again.ok) {
              throw new InvoiceStorageUnavailable(
                `${config.bucket}: HEAD ${key}?versionId answered ${String(again.status)}`,
              );
            }
            if (lockHolds(again.headers)) return 'locked';
          }
          throw new InvoiceStorageRefused(
            `${config.bucket}: DELETE ${key}?versionId answered ${String(response.status)} (${code}) with no lock that holds`,
          );
        }
        if (!response.ok) {
          throw new InvoiceStorageUnavailable(
            `${config.bucket}: DELETE ${key}?versionId answered ${String(response.status)} (${await errorCodeOf(response)})`,
          );
        }
        await response.body?.cancel();
      }
      return listed.versions.length === 0 ? 'absent' : 'removed';
    },
    async holdsVersion(key) {
      return (await versionsOf(key)).versions.length > 0;
    },
  };
}

/**
 * A bucket in memory, for development and the tests (ADR 0037 § 8): written once per key, never replaced, its lock
 * kept as given and only ever lengthened. Lost with the process, so the inline worker of `pnpm dev` and the API share
 * one, which says it is `volatile`: after a restart, a PDF it forgot is not taken for a damaged one.
 */
export interface MemoryInvoiceStore extends InvoiceObjectStore {
  /** Tests only: what a key holds, `undefined` for nothing. */
  peek(key: string): StoredObject | undefined;
  /** Tests only: puts an object as a run that stopped, or a damaged file, would have left it. */
  plant(key: string, object: StoredObject): void;
}

export function createMemoryInvoiceStore(options: { readonly volatile?: boolean } = {}): MemoryInvoiceStore {
  const objects = new Map<string, StoredObject>();
  return {
    // A bucket by default, as the tests want one; `pnpm dev` says it forgets (`composition-root.ts`).
    volatile: options.volatile ?? false,
    writeOnce(key, bytes, sha256, retainUntil) {
      if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
        return Promise.reject(new Error(`The SHA-256 given for ${key} is not that of its bytes`));
      }
      if (objects.has(key)) return Promise.resolve('exists');
      objects.set(key, { bytes: Uint8Array.from(bytes), retainUntil });
      return Promise.resolve('written');
    },
    read(key) {
      const found = objects.get(key);
      return Promise.resolve(
        found === undefined ? null : { bytes: Uint8Array.from(found.bytes), retainUntil: found.retainUntil },
      );
    },
    lengthenLock(key, retainUntil) {
      const found = objects.get(key);
      if (found === undefined) {
        return Promise.reject(new InvoiceStorageUnavailable(`memory: no object at ${key}`));
      }
      // As a compliance lock: never shorter, and a lock the store does not name is never moved.
      if (found.retainUntil === null || retainUntil.getTime() < found.retainUntil.getTime()) {
        return Promise.reject(new InvoiceStorageUnavailable(`memory: the lock of ${key} only lengthens`));
      }
      objects.set(key, { ...found, retainUntil });
      return Promise.resolve();
    },
    remove(key, sha256) {
      const found = objects.get(key);
      if (found === undefined) return Promise.resolve('absent');
      if (createHash('sha256').update(found.bytes).digest('hex') !== sha256)
        return Promise.resolve('altered');
      if (found.retainUntil !== null && found.retainUntil.getTime() > Date.now())
        return Promise.resolve('locked');
      objects.delete(key);
      return Promise.resolve('removed');
    },
    holdsVersion: (key) => Promise.resolve(objects.has(key)),
    peek: (key) => objects.get(key),
    plant: (key, object) => {
      objects.set(key, object);
    },
  };
}
