import { AwsClient } from 'aws4fetch';

import type { AvatarStore } from '../../domain/avatar';

/** The media bucket (`S3_*`) as the composition root reads it; path-style URLs, as the drops' storage. */
interface AvatarBucketConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

type FetchLike = (request: Request) => Promise<Response>;

/** A storage that hangs is a storage that does not answer: the job retries, the page shows her initials. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Her photo in the media bucket (CRM-07 a2b): one small JPEG per creator, in one PUT, read back in one GET. */
export function createS3AvatarStore(config: AvatarBucketConfig, fetchLike?: FetchLike): AvatarStore {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
    region: config.region,
  });
  const send = fetchLike ?? ((request: Request) => fetch(request));
  const bucketUrl = `${config.endpoint.replace(/\/+$/u, '')}/${encodeURIComponent(config.bucket)}`;
  const urlOf = (key: string): string => `${bucketUrl}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const call = async (what: string, key: string, init: RequestInit): Promise<Response> => {
    try {
      return await send(
        new Request(await client.sign(urlOf(key), init), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
      );
    } catch (error) {
      throw new Error(`${config.bucket}: no answer to the ${what} of ${key}`, { cause: error });
    }
  };

  return {
    async put(key, jpeg) {
      const response = await call('write', key, {
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg', 'content-length': String(jpeg.byteLength) },
        body: jpeg,
      });
      await response.body?.cancel();
      if (!response.ok)
        throw new Error(`${config.bucket}: the write of ${key} answered ${String(response.status)}`);
    },

    async get(key) {
      const response = await call('read', key, { method: 'GET' });
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`${config.bucket}: the read of ${key} answered ${String(response.status)}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
