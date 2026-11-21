import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { VaultMedia } from '@impera/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFakeReveal, type FakeReveal } from '../../../../../__tests__/fake-reveal/server';
import { ConnectorError } from '../../../domain/platform-connector';
import type { FileTransport } from '../../download/vault-file';
import { RevealApiConnector } from '../connector';

const run = promisify(execFile);

describe('RevealApiConnector.fetchMedia against FakeReveal (ADR 0113)', () => {
  let fake: FakeReveal;
  let dir: string;
  let vault: VaultMedia[];

  const connect = (
    fileTransport: FileTransport,
    fileHosts: readonly string[] = ['fake-reveal.test'],
  ): RevealApiConnector =>
    new RevealApiConnector({
      session: {
        v: 1,
        bearer: fake.authorization.slice('Bearer '.length),
        userId: fake.userId,
        modelId: fake.modelId,
        userAgent: 'Mozilla/5.0 (test)',
        capturedAt: '2026-10-01T00:00:00.000Z',
      },
      fetch: fake.fetch,
      baseUrl: 'https://reveal.test',
      sleep: () => Promise.resolve(),
      now: () => fake.now(),
      fileTransport,
      fileHosts,
      fileHttpForTests: true,
    });

  const pick = (kind: VaultMedia['kind']): VaultMedia => {
    const media = vault.find((item) => item.kind === kind);
    if (media === undefined) throw new Error(`the fixture needs a ${kind} in the vault`);
    return media;
  };

  beforeAll(async () => {
    fake = createFakeReveal();
    dir = await mkdtemp(join(tmpdir(), 'fetch-media-'));
    vault = (await connect(fake.fileTransport).listVaultMedia({})).filter((media) => media.folder !== null);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await fake.app.close();
  });

  it('reads a photo and a video of the vault to the given path', async () => {
    const connector = connect(fake.fileTransport);
    const photo = pick('image');
    const photoPath = join(dir, 'photo');
    const fetchedPhoto = await connector.fetchMedia(photo.ref, {
      folderRef: photo.folder?.ref ?? null,
      path: photoPath,
    });
    expect((await stat(photoPath)).size).toBe(fetchedPhoto.bytes);

    const video = pick('video');
    const videoPath = join(dir, 'video.ts');
    const fetchedVideo = await connector.fetchMedia(video.ref, {
      folderRef: video.folder?.ref ?? null,
      path: videoPath,
    });
    expect(fetchedVideo.contentType).toBe('video/mp2t');
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      videoPath,
    ]);
    expect(Number(stdout.trim())).toBeGreaterThan(1.5);
  });

  it('sends no header to a host that is not the videos host (ADR 0113 § 2)', async () => {
    const headers: (Readonly<Record<string, string>> | undefined)[] = [];
    const watch: FileTransport = {
      lookup: fake.fileTransport.lookup,
      get: (url, signal, pinned, sent) => {
        headers.push(sent);
        return fake.fileTransport.get(url, signal, pinned);
      },
    };
    const video = pick('video');
    await connect(watch).fetchMedia(video.ref, {
      folderRef: video.folder?.ref ?? null,
      path: join(dir, 'plain'),
    });
    expect(headers.length).toBeGreaterThan(1);
    expect(headers.every((sent) => sent === undefined)).toBe(true);
  });

  it('reads the folder again once when the link is no longer signed, and only once', async () => {
    const photo = pick('image');
    const target = { folderRef: photo.folder?.ref ?? null, path: join(dir, 'again') };
    let refused = 1;
    const onceExpired: FileTransport = {
      lookup: fake.fileTransport.lookup,
      get: (url, signal, pinned) => {
        if (refused > 0) {
          refused -= 1;
          return Promise.resolve(new Response(null, { status: 403 }));
        }
        return fake.fileTransport.get(url, signal, pinned);
      },
    };
    const fetched = await connect(onceExpired).fetchMedia(photo.ref, target);
    expect(fetched.bytes).toBeGreaterThan(0);
    expect(refused).toBe(0);

    refused = 2;
    const error = await connect(onceExpired)
      .fetchMedia(photo.ref, { ...target, path: join(dir, 'again-twice') })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).toMatchObject({ code: 'transient' });
  });

  it('refuses every download while no host is listed, before any call', async () => {
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
    const photo = pick('image');
    await expect(
      connect(spy, []).fetchMedia(photo.ref, {
        folderRef: photo.folder?.ref ?? null,
        path: join(dir, 'none'),
      }),
    ).rejects.toMatchObject({ code: 'fatal' });
    expect(called).toBe(false);
  });

  it('says not_found for a media no longer in its folder', async () => {
    const photo = pick('image');
    await expect(
      connect(fake.fileTransport).fetchMedia(
        { platform: 'reveal', id: 'media_gone' },
        { folderRef: photo.folder?.ref ?? null, path: join(dir, 'gone') },
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
