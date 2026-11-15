import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createFakeReveal, type FakeReveal } from '../../../../../__tests__/fake-reveal/server';
import { defaultIv, HlsUnsupported, parseHlsPlaylist, variantForDescription } from '../hls-playlist';
import { downloadVaultFile, VaultFileError, type DownloadBounds, type VaultFileLink } from '../vault-file';

const run = promisify(execFile);

const BOUNDS: DownloadBounds = { hosts: ['fake-reveal.test'], maxBytes: 50 * 1024 * 1024, timeoutMs: 30_000 };

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
    const response = await fake.fetch(`http://fake-reveal.test/models/${fake.modelId}/medias?take=100`, {
      method: 'GET',
      headers: { authorization: fake.authorization },
      signal: AbortSignal.timeout(10_000),
    });
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
    const file = await downloadVaultFile(fake.fileFetch, photo, path, BOUNDS);
    expect(file.bytes).toBeGreaterThan(0);
    expect((await readFile(path)).byteLength).toBe(file.bytes);
  });

  it('decrypts an HLS video into one MPEG-TS file ffprobe reads', async () => {
    expect(video.isHls).toBe(true);
    const path = join(dir, 'video.ts');
    const file = await downloadVaultFile(fake.fileFetch, video, path, BOUNDS);
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
    await expect(downloadVaultFile(fake.fileFetch, photo, join(dir, 'late'), BOUNDS)).rejects.toMatchObject({
      reason: 'expired',
    });
    await expect(
      downloadVaultFile(fake.fileFetch, video, join(dir, 'late.ts'), BOUNDS),
    ).rejects.toMatchObject({
      reason: 'expired',
    });
  });

  it('refuses a host outside the list without calling it', async () => {
    let called = false;
    const spy: typeof fake.fileFetch = (url, init) => {
      called = true;
      return fake.fileFetch(url, init);
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
  });

  it('stops at the size bound', async () => {
    const fresh = createFakeReveal();
    try {
      const response = await fresh.fetch(`http://fake-reveal.test/models/${fresh.modelId}/medias?take=100`, {
        method: 'GET',
        headers: { authorization: fresh.authorization },
        signal: AbortSignal.timeout(10_000),
      });
      const { data } = WireLinks.parse(JSON.parse(await response.text()));
      const media = data.find((m) => m.type === 'video');
      if (media === undefined) throw new Error('video expected');
      await expect(
        downloadVaultFile(fresh.fileFetch, { url: media.url, isHls: true }, join(dir, 'big.ts'), {
          ...BOUNDS,
          maxBytes: 1024,
        }),
      ).rejects.toMatchObject({ reason: 'too_large' });
    } finally {
      await fresh.app.close();
    }
  });
});
