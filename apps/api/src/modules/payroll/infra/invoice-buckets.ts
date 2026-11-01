import { createHash } from 'node:crypto';

import { AwsClient } from 'aws4fetch';

import { InvoiceStorageUnavailable } from '../domain/errors';
import type { InvoiceObjectStore, StoredObject } from '../domain/ports';

/**
 * The two buckets of invoices (ADR 0037 § 4 and § 6), S3-compatible: Hetzner for the PDFs, OVHcloud for their copy.
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

const base64Of = (algorithm: 'md5' | 'sha256', bytes: Uint8Array): string =>
  createHash(algorithm).update(bytes).digest('base64');

/** The provider's error code (`<Code>AccessDenied</Code>`), never its whole body, for the log and the error. */
async function errorCodeOf(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  return /<Code>([^<]{1,64})<\/Code>/u.exec(body)?.[1] ?? 'no code';
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
  /** `query`: a subresource of the object (`retention`), signed with it. */
  const call = async (key: string, init: RequestInit, query = ''): Promise<Response> => {
    try {
      const signed = await client.sign(query === '' ? urlOf(key) : `${urlOf(key)}?${query}`, init);
      return await send(new Request(signed, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }));
    } catch (error) {
      throw new InvoiceStorageUnavailable(`${config.bucket}: no answer for ${key}`, { cause: error });
    }
  };
  return {
    volatile: false,
    async writeOnce(key, bytes, sha256, retainUntil) {
      if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
        throw new Error(`The SHA-256 given for ${key} is not that of its bytes`);
      }
      const response = await call(key, {
        method: 'PUT',
        body: bytes,
        headers: {
          'content-type': 'application/pdf',
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
    peek: (key) => objects.get(key),
    plant: (key, object) => {
      objects.set(key, object);
    },
  };
}
