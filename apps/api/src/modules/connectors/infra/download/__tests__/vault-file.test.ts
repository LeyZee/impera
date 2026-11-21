import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createFakeReveal, type FakeReveal } from '../../../../../__tests__/fake-reveal/server';
import { defaultIv, HlsUnsupported, parseHlsPlaylist, variantForDescription } from '../hls-playlist';
import {
  downloadVaultFile,
  VaultFileError,
  type DownloadBounds,
  type FileTransport,
  type VaultFileLink,
} from '../vault-file';

const run = promisify(execFile);

const BOUNDS: DownloadBounds = {
  hosts: ['fake-reveal.test'],
  maxBytes: 50 * 1024 * 1024,
  timeoutMs: 30_000,
  maxSegments: 100,
  maxKeys: 2,
  allowHttp: true,
};

/** A transport that answers every GET with `body`, streamed in 1 KiB chunks and with no length announced. */
function streaming(total: number, onGet?: () => void): FileTransport {
  return {
    lookup: () => Promise.resolve([{ address: '203.0.113.10', family: 4 }]),
    get: () => {
      onGet?.();
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= total) {
            controller.close();
            return;
          }
          sent += 1024;
          controller.enqueue(new Uint8Array(1024));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    },
  };
}

const WireLinks = z.object({
  data: z.array(
    z.object({ id: z.string(), type: z.string(), url: z.string(), isHls: z.boolean().optional() }),
  ),
});

describe('parseHlsPlaylist', () => {
  it('resolves a master playlist and picks the highest variant up to 720 lines', () => {
    const playlist = parseHlsPlaylist(
      [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
        '360p/video.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720',
        '720p/video.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
        '1080p/video.m3u8',
      ].join('\n'),
      'https://cdn.example/v/abc/playlist.m3u8',
    );
    expect(playlist.kind).toBe('master');
    if (playlist.kind !== 'master') return;
    expect(variantForDescription(playlist.variants)?.uri).toBe('https://cdn.example/v/abc/720p/video.m3u8');
  });

  it('falls back to the smallest variant when all are above 720 lines', () => {
    const playlist = parseHlsPlaylist(
      [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=3840x2160',
        'a.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
        'b.m3u8',
      ].join('\n'),
      'https://cdn.example/x/p.m3u8',
    );
    if (playlist.kind !== 'master') throw new Error('master expected');
    expect(variantForDescription(playlist.variants)?.uri).toBe('https://cdn.example/x/b.m3u8');
  });

  it('reads segments, the key, an explicit IV and the default IV by sequence', () => {
    const playlist = parseHlsPlaylist(
      [
        '#EXTM3U',
        '#EXT-X-MEDIA-SEQUENCE:7',
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
        '#EXTINF:4.0,',
        'seg7.ts',
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x000000000000000000000000000000ff',
        '#EXTINF:4.0,',
        'seg8.ts',
        '#EXT-X-KEY:METHOD=NONE',
        '#EXTINF:4.0,',
        'seg9.ts',
        '#EXT-X-ENDLIST',
      ].join('\n'),
      'https://cdn.example/v/media.m3u8',
    );
    if (playlist.kind !== 'media') throw new Error('media expected');
    expect(playlist.ended).toBe(true);
    const [first, second, third] = playlist.segments;
    expect(first?.uri).toBe('https://cdn.example/v/seg7.ts');
    expect(first?.key?.uri).toBe('https://cdn.example/v/key.bin');
    expect(first?.key?.iv.equals(defaultIv(7))).toBe(true);
    expect(second?.key?.iv.toString('hex')).toBe('000000000000000000000000000000ff');
    expect(third?.key).toBeNull();
  });

  it('refuses what a vault file does not use', () => {
    expect(() =>
      parseHlsPlaylist('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\na.m4s\n', 'https://c.example/p'),
    ).toThrow(HlsUnsupported);
    expect(() => parseHlsPlaylist('not a playlist', 'https://c.example/p')).toThrow(HlsUnsupported);
  });
});

describe('downloadVaultFile against FakeReveal', () => {
  let fake: FakeReveal;
  let dir: string;
  let photo: VaultFileLink;
  let video: VaultFileLink;

  beforeAll(async () => {
    fake = createFakeReveal();
    dir = await mkdtemp(join(tmpdir(), 'vault-file-'));
    const response = await fake.fetch(
      `http://fake-reveal.test/models/${fake.modelId}/medias?take=100&mediaType=All`,
      {
        method: 'GET',
        headers: { authorization: fake.authorization },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const { data } = WireLinks.parse(JSON.parse(await response.text()));
    const firstPhoto = data.find((m) => m.type === 'photo');
    const firstVideo = data.find((m) => m.type === 'video');
    if (firstPhoto === undefined || firstVideo === undefined)
      throw new Error('the fixture needs a photo and a video');
    photo = { url: firstPhoto.url, isHls: firstPhoto.isHls ?? false };
    video = { url: firstVideo.url, isHls: firstVideo.isHls ?? false };
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await fake.app.close();
  });

  it('downloads a photo in one GET', async () => {
    const path = join(dir, 'photo');
    const file = await downloadVaultFile(fake.fileTransport, photo, path, BOUNDS);
    expect(file.bytes).toBeGreaterThan(0);
    expect((await readFile(path)).byteLength).toBe(file.bytes);
  });

  it('connects to the address it checked, and sends nothing of a session', async () => {
    const seen: { url: string; address: string; args: number }[] = [];
    const watch: FileTransport = {
      lookup: fake.fileTransport.lookup,
      get: (...args) => {
        const [url, signal, pinned] = args;
        seen.push({ url, address: pinned.address, args: args.length });
        return fake.fileTransport.get(url, signal, pinned);
      },
    };
    await downloadVaultFile(watch, photo, join(dir, 'watched'), BOUNDS);
    expect(seen).toEqual([{ url: photo.url, address: '203.0.113.10', args: 3 }]);
  });

  it('decrypts an HLS video into one MPEG-TS file ffprobe reads', async () => {
    expect(video.isHls).toBe(true);
    const path = join(dir, 'video.ts');
    const file = await downloadVaultFile(fake.fileTransport, video, path, BOUNDS);
    expect(file.contentType).toBe('video/mp2t');
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      path,
    ]);
    expect(Number(stdout.trim())).toBeGreaterThan(1.5);
  });

  it('says « expired » once the link is no longer signed', async () => {
    await fake.app.inject({ method: 'POST', url: '/__clock', payload: { advanceMs: 11 * 60_000 } });
    await expect(
      downloadVaultFile(fake.fileTransport, photo, join(dir, 'late'), BOUNDS),
    ).rejects.toMatchObject({
      reason: 'expired',
    });
    await expect(
      downloadVaultFile(fake.fileTransport, video, join(dir, 'late.ts'), BOUNDS),
    ).rejects.toMatchObject({
      reason: 'expired',
    });
  });

  it('refuses a host outside the list without calling it', async () => {
    let called = false;
    const spy: FileTransport = {
      lookup: (host) => {
        called = true;
        return fake.fileTransport.lookup(host);
      },
      get: (url, signal, pinned) => {
        called = true;
        return fake.fileTransport.get(url, signal, pinned);
      },
    };
    const error = await downloadVaultFile(
      spy,
      { url: 'https://elsewhere.example/a.jpg', isHls: false },
      join(dir, 'x'),
      BOUNDS,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(VaultFileError);
    expect(error).toMatchObject({ reason: 'host_refused' });
    expect(called).toBe(false);
    await expect(
      downloadVaultFile(
        spy,
        { url: 'https://user:pw@fake-reveal.test/a', isHls: false },
        join(dir, 'y'),
        BOUNDS,
      ),
    ).rejects.toMatchObject({ reason: 'host_refused' });
    for (const url of [
      'http://fake-reveal.test/a',
      'https://fake-reveal.test:8443/a',
      'https://203.0.113.10/a',
      'https://[2001:db8::1]/a',
      'ftp://fake-reveal.test/a',
      'https://x.fake-reveal.test/a',
      'https://fake-reveal.test.elsewhere.example/a',
    ]) {
      await expect(
        downloadVaultFile(spy, { url, isHls: false }, join(dir, 'z'), { ...BOUNDS, allowHttp: false }),
      ).rejects.toMatchObject({ reason: 'host_refused' });
    }
    expect(called).toBe(false);
  });

  it('refuses a host that resolves to a private address, before any GET', async () => {
    let got = false;
    for (const address of ['10.0.0.5', '127.0.0.1', '::ffff:192.168.1.1', 'fd00::1']) {
      const inside: FileTransport = {
        lookup: () =>
          Promise.resolve([
            { address: '203.0.113.10', family: 4 },
            { address, family: address.includes(':') ? 6 : 4 },
          ]),
        get: (url, signal, pinned) => {
          got = true;
          return fake.fileTransport.get(url, signal, pinned);
        },
      };
      await expect(downloadVaultFile(inside, photo, join(dir, 'inside'), BOUNDS)).rejects.toMatchObject({
        reason: 'host_refused',
      });
    }
    expect(got).toBe(false);
  });

  it('cuts a body with no length announced at the bound, and leaves no file behind', async () => {
    const path = join(dir, 'unbounded');
    await expect(
      downloadVaultFile(streaming(64 * 1024), { url: 'https://fake-reveal.test/big', isHls: false }, path, {
        ...BOUNDS,
        maxBytes: 8 * 1024,
      }),
    ).rejects.toMatchObject({ reason: 'too_large' });
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never writes over a file that is already there', async () => {
    const path = join(dir, 'taken');
    await writeFile(path, 'already here');
    let got = false;
    await expect(
      downloadVaultFile(
        streaming(1024, () => {
          got = true;
        }),
        { url: 'https://fake-reveal.test/a', isHls: false },
        path,
        BOUNDS,
      ),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(got).toBe(false);
    expect(await readFile(path, 'utf8')).toBe('already here');
  });

  it('stops at the size bound', async () => {
    const fresh = createFakeReveal();
    try {
      const response = await fresh.fetch(
        `http://fake-reveal.test/models/${fresh.modelId}/medias?take=100&mediaType=All`,
        {
          method: 'GET',
          headers: { authorization: fresh.authorization },
          signal: AbortSignal.timeout(10_000),
        },
      );
      const { data } = WireLinks.parse(JSON.parse(await response.text()));
      const media = data.find((m) => m.type === 'video');
      if (media === undefined) throw new Error('video expected');
      await expect(
        downloadVaultFile(fresh.fileTransport, { url: media.url, isHls: true }, join(dir, 'big.ts'), {
          ...BOUNDS,
          maxBytes: 1024,
        }),
      ).rejects.toMatchObject({ reason: 'too_large' });
    } finally {
      await fresh.app.close();
    }
  });
});

describe('downloadVaultFile: the origin header of the videos host', () => {
  const REFERER = { host: 'videos.test', value: 'https://dashboard.example/' } as const;
  const bounds: DownloadBounds = {
    ...BOUNDS,
    hosts: ['videos.test', 'photos.test'],
    allowHttp: true,
    referer: REFERER,
  };
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vault-referer-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Records each GET's headers, answers `status` (a redirect included) or a small body. */
  function recording(status = 200) {
    const seen: { url: string; headers: Readonly<Record<string, string>> | undefined; args: number }[] = [];
    const transport: FileTransport = {
      lookup: () => Promise.resolve([{ address: '203.0.113.10', family: 4 }]),
      get: (...args) => {
        const [url, , , headers] = args;
        seen.push({ url, headers, args: args.length });
        return Promise.resolve(
          status === 200
            ? new Response(new Uint8Array(16), { status })
            : new Response(null, { status, headers: { location: 'https://elsewhere.example/a' } }),
        );
      },
    };
    return { seen, transport };
  }

  it('sends that value to that host over HTTPS, and nothing else', async () => {
    const { seen, transport } = recording();
    await downloadVaultFile(
      transport,
      { url: 'https://videos.test/a', isHls: false },
      join(dir, 'a'),
      bounds,
    );
    expect(seen).toEqual([
      { url: 'https://videos.test/a', headers: { referer: 'https://dashboard.example/' }, args: 4 },
    ]);
  });

  it('sends no header to another listed host, nor to that host over plain HTTP', async () => {
    const { seen, transport } = recording();
    await downloadVaultFile(
      transport,
      { url: 'https://photos.test/a', isHls: false },
      join(dir, 'b'),
      bounds,
    );
    await downloadVaultFile(transport, { url: 'http://videos.test/a', isHls: false }, join(dir, 'c'), bounds);
    expect(seen.map(({ headers, args }) => ({ headers, args }))).toEqual([
      { headers: undefined, args: 3 },
      { headers: undefined, args: 3 },
    ]);
  });

  it('follows no redirect from that host', async () => {
    const { seen, transport } = recording(302);
    await expect(
      downloadVaultFile(transport, { url: 'https://videos.test/a', isHls: false }, join(dir, 'd'), bounds),
    ).rejects.toMatchObject({ reason: 'failed' });
    expect(seen.map(({ url }) => url)).toEqual(['https://videos.test/a']);
  });
});
