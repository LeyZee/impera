import { describe, expect, it } from 'vitest';

import type { DownloadBounds, FileTransport } from '../../download/vault-file';
import { previewBounds, readPreviewFile } from '../preview';

/** The first bytes of a PNG: enough for the picture to be read as one. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const PLAIN: DownloadBounds = {
  hosts: ['videos.test', 'photos.test'],
  maxBytes: 2 * 1024 ** 3,
  timeoutMs: 600_000,
  maxSegments: 4000,
  maxKeys: 8,
};
const FILES: DownloadBounds = {
  ...PLAIN,
  referer: { host: 'videos.test', value: 'https://dashboard.example/' },
};

/** Records each GET's headers and answers a small PNG. */
function recording() {
  const seen: { url: string; headers: Readonly<Record<string, string>> | undefined }[] = [];
  const transport: FileTransport = {
    lookup: () => Promise.resolve([{ address: '203.0.113.10', family: 4 }]),
    get: (url, _signal, _pinned, headers) => {
      seen.push({ url, headers });
      return Promise.resolve(new Response(PNG, { status: 200 }));
    },
  };
  return { seen, transport };
}

describe('previewBounds and readPreviewFile: the origin header of the videos host (ADR 0113 § 2, ADR 0138)', () => {
  it('keeps the files origin header as it is, and the preview size', () => {
    const bounds = previewBounds(FILES);
    expect(bounds.referer).toBe(FILES.referer);
    expect(bounds.hosts).toBe(FILES.hosts);
    expect(bounds.maxSegments).toBe(0);
    expect(previewBounds(PLAIN).referer).toBeUndefined();
  });

  it("sends it for a video's poster on the videos host, and to no other host", async () => {
    const { seen, transport } = recording();
    const bounds = previewBounds(FILES);
    await expect(readPreviewFile(transport, 'https://videos.test/poster.jpg', bounds)).resolves.toMatchObject(
      {
        contentType: 'image/png',
      },
    );
    await readPreviewFile(transport, 'https://photos.test/small.jpg', bounds);
    expect(seen).toEqual([
      { url: 'https://videos.test/poster.jpg', headers: { referer: 'https://dashboard.example/' } },
      { url: 'https://photos.test/small.jpg', headers: undefined },
    ]);
  });
});
