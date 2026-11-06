import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ContentDropStorageUnavailable } from '../../../domain/errors';
import { createS3DropStorage, xmlText } from '../s3';

describe('content-drops › the storage’s XML answers', () => {
  it('reads an ETag back whatever way its quotes were written', () => {
    expect(xmlText('<ETag>&quot;abc&quot;</ETag>', 'ETag')).toBe('"abc"');
    // MinIO, CI 03/11.
    expect(xmlText('<ETag>&#34;abc&#34;</ETag>', 'ETag')).toBe('"abc"');
    expect(xmlText('<ETag>&#x22;abc&#X22;</ETag>', 'ETag')).toBe('"abc"');
    expect(xmlText('<Key>a&amp;b&lt;c</Key>', 'Key')).toBe('a&b<c');
    expect(xmlText('<Key>a&unknown;b</Key>', 'Key')).toBe('a&unknown;b');
    expect(xmlText('<Other>x</Other>', 'Key')).toBeNull();
    // Past the last code point it stays as written, never throws (Bilan on #512).
    expect(xmlText('<Key>a&#x110000;b&#99999999;</Key>', 'Key')).toBe('a&#x110000;b&#99999999;');
  });
});

describe('content-drops › the size of a stored object', () => {
  const storageAnswering = (headers: Record<string, string>, status = 200) =>
    createS3DropStorage(
      {
        endpoint: 'http://objects.example.test',
        region: 'us-east-1',
        bucket: 'medias',
        accessKeyId: 'EXAMPLEKEYID',
        secretAccessKey: 'example-secret-for-tests-only',
      },
      () => Promise.resolve(new Response(null, { status, headers })),
    );

  it('reads its length, `null` when absent, and never takes a missing length for 0 (Bilan on #512)', async () => {
    expect(await storageAnswering({ 'content-length': '1234' }).sizeOf('incoming/a/b')).toBe(1234);
    expect(await storageAnswering({}, 404).sizeOf('incoming/a/b')).toBeNull();
    await expect(storageAnswering({}).sizeOf('incoming/a/b')).rejects.toThrow(ContentDropStorageUnavailable);
  });
});

describe('content-drops › a large cleaned file sent by the server', () => {
  it('abandons its send when a part is refused, so that nothing stays open under media/ (Bilan on #516)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'impera-s3-test-'));
    try {
      const path = join(dir, 'cleaned');
      await writeFile(path, '');
      // Sparse: past the single PUT, so it goes in parts.
      await truncate(path, 17 * 1024 * 1024);
      const calls: string[] = [];
      const storage = createS3DropStorage(
        {
          endpoint: 'http://objects.example.test',
          region: 'us-east-1',
          bucket: 'medias',
          accessKeyId: 'EXAMPLEKEYID',
          secretAccessKey: 'example-secret-for-tests-only',
        },
        (request) => {
          const url = new URL(request.url);
          calls.push(`${request.method} ${url.search}`);
          if (request.method === 'POST')
            return Promise.resolve(
              new Response(
                '<InitiateMultipartUploadResult><UploadId>u-1</UploadId></InitiateMultipartUploadResult>',
              ),
            );
          if (request.method === 'PUT')
            return Promise.resolve(new Response('<Error><Code>SlowDown</Code></Error>', { status: 503 }));
          return Promise.resolve(new Response(null, { status: 204 }));
        },
      );
      await expect(storage.upload('media/a/b', path, 'image/jpeg', 'f'.repeat(64))).rejects.toThrow(
        ContentDropStorageUnavailable,
      );
      expect(calls).toEqual(['POST ?uploads', 'PUT ?partNumber=1&uploadId=u-1', 'DELETE ?uploadId=u-1']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('content-drops › a kept medium read for a script’s archive (SC-03 c)', () => {
  const storageAnswering = (answer: () => Response) =>
    createS3DropStorage(
      {
        endpoint: 'http://objects.example.test',
        region: 'us-east-1',
        bucket: 'medias',
        accessKeyId: 'EXAMPLEKEYID',
        secretAccessKey: 'example-secret-for-tests-only',
      },
      () => Promise.resolve(answer()),
    );
  const all = async (chunks: AsyncIterable<Uint8Array>) => {
    const parts: Uint8Array[] = [];
    for await (const chunk of chunks) parts.push(chunk);
    return Buffer.concat(parts).toString();
  };

  it('streams its bytes, `null` when it is gone, and refuses another answer', async () => {
    const read = await storageAnswering(() => new Response('des octets inventés')).read('media/a/b');
    expect(read).not.toBeNull();
    if (read !== null) expect(await all(read)).toBe('des octets inventés');
    expect(await storageAnswering(() => new Response(null, { status: 404 })).read('media/a/b')).toBeNull();
    await expect(
      storageAnswering(() => new Response('<Error/>', { status: 403 })).read('media/a/b'),
    ).rejects.toThrow(ContentDropStorageUnavailable);
  });

  it('turns a stream cut midway into the storage’s refusal', async () => {
    const cut = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('début'));
        controller.error(new Error('connection reset'));
      },
    });
    const read = await storageAnswering(() => new Response(cut)).read('media/a/b');
    expect(read).not.toBeNull();
    if (read !== null) await expect(all(read)).rejects.toThrow(ContentDropStorageUnavailable);
  });

  it('closes the storage’s connection when the archive stops before the end', async () => {
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('encore'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const read = await storageAnswering(() => new Response(endless)).read('media/a/b');
    expect(read).not.toBeNull();
    if (read !== null)
      for await (const chunk of read) {
        expect(chunk.byteLength).toBeGreaterThan(0);
        break;
      }
    expect(cancelled).toBe(true);
  });
});
