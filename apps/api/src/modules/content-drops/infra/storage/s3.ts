import { DROP_PART_URL_SECONDS, type DropMime } from '@impera/contracts';
import { AwsClient } from 'aws4fetch';

import { ContentDropStorageUnavailable } from '../../domain/errors';
import type { DropStorage } from '../../domain/ports';
import type { StoredPart } from '../../domain/upload';

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

/** The provider's error code (`<Code>NoSuchUpload</Code>`), never its whole body. */
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
  const bucketUrl = `${config.endpoint.replace(/\/+$/u, '')}/${encodeURIComponent(config.bucket)}`;
  const urlOf = (key: string, query = ''): string =>
    `${bucketUrl}/${key.split('/').map(encodeURIComponent).join('/')}${query === '' ? '' : `?${query}`}`;

  const call = async (what: string, url: string, init: RequestInit): Promise<Response> => {
    try {
      return await send(
        new Request(await client.sign(url, init), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
      );
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

  return {
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
      const length = Number(response.headers.get('content-length'));
      if (!Number.isInteger(length)) {
        throw new ContentDropStorageUnavailable(`${config.bucket}: ${what} gave no size`);
      }
      return length;
    },

    async remove(key) {
      const what = `DELETE ${key}`;
      const response = await call(what, urlOf(key), { method: 'DELETE' });
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) return refused(what, response);
    },
  };
}
