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
