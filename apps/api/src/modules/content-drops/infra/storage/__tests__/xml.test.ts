import { describe, expect, it } from 'vitest';

import { xmlText } from '../s3';

describe('content-drops › the storage’s XML answers', () => {
  it('reads an ETag back whatever way its quotes were written', () => {
    expect(xmlText('<ETag>&quot;abc&quot;</ETag>', 'ETag')).toBe('"abc"');
    // MinIO, CI 03/11.
    expect(xmlText('<ETag>&#34;abc&#34;</ETag>', 'ETag')).toBe('"abc"');
    expect(xmlText('<ETag>&#x22;abc&#X22;</ETag>', 'ETag')).toBe('"abc"');
    expect(xmlText('<Key>a&amp;b&lt;c</Key>', 'Key')).toBe('a&b<c');
    expect(xmlText('<Key>a&unknown;b</Key>', 'Key')).toBe('a&unknown;b');
    expect(xmlText('<Other>x</Other>', 'Key')).toBeNull();
  });
});
