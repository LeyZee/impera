import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DESCRIPTION_TRIES, err, ok, type DropMediaDescription, type VaultMedia } from '@impera/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ConnectorError } from '../modules/connectors/domain/platform-connector';
import type { FileTransport } from '../modules/connectors/infra/download/vault-file';
import { RevealApiConnector } from '../modules/connectors/infra/reveal/connector';
import { pictureOf } from '../modules/content-drops/application/thumbnail';
import { createThumbnailer } from '../modules/content-drops/infra/cleaning/thumbnail';
import {
  createDropDescriber,
  type DropSensed,
  type DropSenser,
  type DropSenseRequest,
} from '../modules/media/application/describe-drop';
import {
  describeVault,
  VaultPictureNotRemoved,
  type VaultAsset,
  type VaultDescribeStore,
  type VaultFileRead,
  type VaultRef,
} from '../modules/media/application/describe-vault';
import type { VaultScript } from '../modules/media/domain/vault';
import { createFfmpegFileTools, remuxVaultStream } from '../modules/media/infra/ffmpeg-media-tools';

import { createFakeReveal, type FakeReveal } from './fake-reveal/server';

/** Invented (ADR 0010): what the stub vision says of anything it is shown. */
const DESCRIBED: DropMediaDescription = {
  vocabularyVersion: '1.0.0',
  kind: 'image',
  detailed: 'Mire de test colorée sur fond uni, sans personne ; texte de test inventé pour le coffre.',
  factualDescription: 'Mire de test colorée.',
  durationS: null,
  segments: [],
  intensity: 'soft',
  anatomyVisible: [],
  castMode: 'solo',
  mood: [],
  setting: null,
  audio: null,
  textVisible: null,
  quality: 'good',
  confidenceLow: false,
  notVisible: false,
  flags: [],
};

const CREATOR = 'creator_test';
const ACCOUNT = 'account_test';

/**
 * `media.describe_vault`'s path from FakeReveal to the rows (ADR 0113): the real Reveal connector and its download, the
 * real ffmpeg (stream copied, frames, picture), a stub vision and an in-memory store. What must hold: a photo and a
 * video described, nothing left in the job's folder nor in the storage but the picture, a known fingerprint linked with
 * no vision call, a spent budget stopping the run and the next one resuming without a double, an expired link read
 * again once, and a file we do not read left to the agency.
 */
describe('media.describe_vault on FakeReveal (ADR 0113)', () => {
  let fake: FakeReveal;
  let root: string;
  let scratch: string;
  let vault: VaultMedia[];

  /** The store's state, as the tables would hold it. */
  let refs: Map<string, VaultRef & { asset: string | null; failures: number }>;
  let assets: Map<
    string,
    VaultAsset & { readonly id: string; readonly described: DropSensed | null; readonly fromFan?: boolean }
  >;
  let platformTexts: { mediaAssetId: string; text: string }[];
  let scripts: VaultScript[];
  let queued: (Date | null)[];
  /** The storage: only the pictures may land here. */
  let stored: Map<string, Uint8Array>;
  let seen: DropSenseRequest[];
  let vision: { answer: 'ok' | 'budget' | 'failed' };

  const store: VaultDescribeStore = {
    account: (id) => Promise.resolve(id === ACCOUNT ? { creatorId: CREATOR } : null),
    waiting: () =>
      Promise.resolve({
        refs: [...refs.values()].filter((ref) => ref.asset === null && ref.failures < DESCRIPTION_TRIES),
        scripts,
      }),
    assetOf: (_creatorId, sha256) => {
      const asset = [...assets.values()].find((known) => known.sha256 === sha256);
      return Promise.resolve(asset === undefined ? null : { id: asset.id, fromFan: asset.fromFan === true });
    },
    link: (_creatorId, ref, mediaAssetId) => {
      const row = refs.get(ref.refId);
      if (row?.asset === null) row.asset = mediaAssetId;
      if (ref.platformDescription !== null)
        platformTexts.push({ mediaAssetId, text: ref.platformDescription });
      return Promise.resolve();
    },
    keep: (_creatorId, ref, asset, described) => {
      const id = `asset_${String(assets.size + 1)}`;
      assets.set(id, { ...asset, id, described });
      if (ref.platformDescription !== null)
        platformTexts.push({ mediaAssetId: id, text: ref.platformDescription });
      const row = refs.get(ref.refId);
      if (row !== undefined) row.asset = id;
      return Promise.resolve('kept');
    },
    failed: (refId, count) => {
      const row = refs.get(refId);
      if (row === undefined) return Promise.resolve(0);
      row.failures = Math.min(row.failures + count, DESCRIPTION_TRIES);
      return Promise.resolve(row.failures);
    },
    later: (_job, runAt) => {
      queued.push(runAt);
      return Promise.resolve();
    },
  };

  const sense: DropSenser = (request) => {
    if (vision.answer === 'budget') return Promise.resolve(err('budget'));
    if (vision.answer === 'failed') return Promise.resolve(err('failed'));
    seen.push(request);
    return Promise.resolve(
      ok({ description: { ...DESCRIBED, kind: request.kind }, model: 'vision-test', promptHash: 'drop-v1' }),
    );
  };

  const connect = (transport: FileTransport): RevealApiConnector =>
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
      fileTransport: transport,
      fileHosts: ['fake-reveal.test'],
      fileHttpForTests: true,
    });

  /** The connectors' `VaultFiles` as it answers, on the real connector. */
  const readWith =
    (transport: FileTransport): VaultFileRead =>
    async (ask) => {
      try {
        const fetched = await connect(transport).fetchMedia(
          { platform: 'reveal', id: ask.platformMediaId },
          {
            folderRef: ask.folderRef === null ? null : { platform: 'reveal', id: ask.folderRef },
            path: ask.path,
          },
        );
        return { status: 'fetched', bytes: fetched.bytes };
      } catch (error) {
        if (!(error instanceof ConnectorError)) throw error;
        if (error.code === 'not_found') return { status: 'gone' };
        if (error.code === 'fatal') return { status: 'unreadable' };
        if (error.code === 'transient') return { status: 'later' };
        return { status: 'unavailable', reason: error.code };
      }
    };

  const deps = (read: VaultFileRead = readWith(fake.fileTransport)) => ({
    store,
    read,
    describer: createDropDescriber({ sense, tools: createFfmpegFileTools() }),
    tools: createFfmpegFileTools(),
    remux: remuxVaultStream,
    picture: (ask: { creatorId: string; sha256: string; path: string; kind: 'image' | 'video' }) =>
      pictureOf(
        {
          thumbnailer: createThumbnailer(),
          scratchDir: scratch,
          storage: {
            upload: async (key, path) => {
              stored.set(key, new Uint8Array(await readFile(path)));
            },
          },
        },
        ask,
      ),
    unpicture: (key: string) => {
      stored.delete(key);
      return Promise.resolve();
    },
    scratchDir: scratch,
    now: () => new Date('2027-03-01T12:00:00.000Z'),
  });

  const run = (read?: VaultFileRead) =>
    describeVault(deps(read), { platformAccountId: ACCOUNT, correlationId: 'test' });

  const refOf = (media: VaultMedia): VaultRef & { asset: string | null; failures: number } => ({
    refId: `ref_${media.ref.id}`,
    platformMediaId: media.ref.id,
    kind: media.kind === 'video' ? 'video' : 'image',
    folderRef: media.folder?.ref.id ?? null,
    folderName: media.folder?.name ?? null,
    platformCreatedAt: media.createdAt,
    folderPosition: media.folderPosition,
    platformDescription: media.description,
    platform: 'reveal',
    asset: null,
    failures: 0,
  });

  /** The store holds these vault media only, as the sync would have written them. */
  const holding = (...ids: string[]): void => {
    refs = new Map();
    for (const id of ids) {
      const media = vault.find((item) => item.ref.id === id);
      if (media === undefined) throw new Error(`${id} is not in FakeReveal's vault`);
      const ref = refOf(media);
      refs.set(ref.refId, ref);
    }
  };

  const pick = (kind: VaultMedia['kind']): VaultMedia => {
    const media = vault.find((item) => item.kind === kind && item.folder !== null);
    if (media === undefined) throw new Error(`the fixture needs a ${kind} in a folder`);
    return media;
  };

  beforeAll(async () => {
    fake = createFakeReveal();
    root = await mkdtemp(join(tmpdir(), 'vault-describe-'));
    vault = await connect(fake.fileTransport).listVaultMedia({});
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await fake.app.close();
  });

  beforeEach(async () => {
    scratch = join(root, `scratch-${String(Date.now())}-${String(Math.random()).slice(2)}`);
    await mkdir(scratch);
    assets = new Map();
    platformTexts = [];
    scripts = [];
    queued = [];
    stored = new Map();
    seen = [];
    vision = { answer: 'ok' };
  });

  it('describes a photo and a video, keeps them born erased with their picture, and leaves no byte behind', async () => {
    const photo = pick('image');
    const video = pick('video');
    holding(photo.ref.id, video.ref.id);

    expect(await run()).toMatchObject({ stop: 'done', described: 2, linked: 0, toAgency: 0, skipped: 0 });

    expect(seen.map((request) => request.kind).sort()).toEqual(['image', 'video']);
    const kept = [...assets.values()];
    expect(kept.map((asset) => asset.kind).sort()).toEqual(['image', 'video']);
    const keptVideo = kept.find((asset) => asset.kind === 'video');
    expect(keptVideo?.mime).toBe('video/mp2t');
    expect(keptVideo?.durationMs).toBeGreaterThan(1_500);
    for (const asset of kept) {
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.bytes).toBeGreaterThan(0);
      expect(asset.thumbnailKey).toBe(`thumbnails/${CREATOR}/${asset.sha256}.jpg`);
      expect(asset.described?.description.detailed).toBe(DESCRIBED.detailed);
    }
    // The storage holds the two pictures and nothing else; the job's folders are gone.
    expect([...stored.keys()].sort()).toEqual(kept.map((asset) => asset.thumbnailKey).sort());
    expect(await readdir(scratch)).toEqual([]);
    expect([...refs.values()].every((ref) => ref.asset !== null)).toBe(true);
  });

  it('links a media whose fingerprint she already has, without calling the vision', async () => {
    // FakeReveal serves every photo with the same bytes: the second is the first one again.
    const photos = vault.filter((item) => item.kind === 'image' && item.folder !== null).slice(0, 2);
    holding(...photos.map((photo) => photo.ref.id));

    expect(await run()).toMatchObject({ stop: 'done', described: 1, linked: 1 });
    expect(seen).toHaveLength(1);
    expect(assets.size).toBe(1);
    const [only] = [...assets.keys()];
    expect([...refs.values()].map((ref) => ref.asset)).toEqual([only, only]);
    expect(await readdir(scratch)).toEqual([]);
  });

  it('never links a vault file to the same bytes a fan sent: left to the agency, no vision', async () => {
    const photos = vault.filter((item) => item.kind === 'image' && item.folder !== null).slice(0, 2);
    const [first, second] = photos;
    if (first === undefined || second === undefined) throw new Error('two photos expected');
    holding(first.ref.id);
    expect(await run()).toMatchObject({ described: 1 });
    // The same bytes, as a fan's media this time.
    for (const [id, asset] of assets) assets.set(id, { ...asset, fromFan: true });
    holding(second.ref.id);
    seen = [];

    expect(await run()).toMatchObject({ stop: 'done', described: 0, linked: 0, toAgency: 1 });
    expect(seen).toHaveLength(0);
    expect([...refs.values()]).toMatchObject([{ asset: null, failures: DESCRIPTION_TRIES }]);
    expect(await readdir(scratch)).toEqual([]);
  });

  it('removes the folders a killed run left behind, and only those old enough to be no running run’s', async () => {
    const at = new Date('2027-03-01T12:00:00.000Z');
    const leftovers = {
      'impera-vault-old': 90,
      'impera-picture-old': 120,
      'impera-vault-busy': 45,
      'other-old': 180,
    };
    for (const [name, minutes] of Object.entries(leftovers)) {
      await mkdir(join(scratch, name));
      await writeFile(join(scratch, name, 'original'), 'bytes');
      const when = new Date(at.getTime() - minutes * 60_000);
      await utimes(join(scratch, name), when, when);
    }

    await run();
    expect((await readdir(scratch)).sort()).toEqual(['impera-vault-busy', 'other-old']);
    await rm(join(scratch, 'impera-vault-busy'), { recursive: true });
    await rm(join(scratch, 'other-old'), { recursive: true });
  });

  it('stops at the spent budget, puts itself off an hour, and the next run resumes without a double', async () => {
    const photo = pick('image');
    const video = pick('video');
    holding(photo.ref.id, video.ref.id);

    vision.answer = 'budget';
    expect(await run()).toMatchObject({ stop: 'budget', described: 0 });
    expect(queued).toEqual([new Date('2027-03-01T13:00:00.000Z')]);
    expect(assets.size).toBe(0);
    // The first file's picture, made before the vision refused, is removed: no media carries it (ADR 0113 § 1).
    expect(stored.size).toBe(0);
    expect(await readdir(scratch)).toEqual([]);

    vision.answer = 'ok';
    expect(await run()).toMatchObject({ stop: 'done', described: 2 });
    expect(await run()).toMatchObject({ stop: 'done', described: 0, linked: 0 });
    expect(assets.size).toBe(2);
    expect(stored.size).toBe(2);
    expect(seen).toHaveLength(2);
  });

  it('counts a run where every vision model failed, and leaves the media to the agency after its tries', async () => {
    holding(pick('image').ref.id);
    vision.answer = 'failed';
    for (let attempt = 1; attempt <= DESCRIPTION_TRIES; attempt++) {
      expect(await run()).toMatchObject({ stop: 'models' });
    }
    expect([...refs.values()][0]?.failures).toBe(DESCRIPTION_TRIES);
    expect(await run()).toMatchObject({ stop: 'done', described: 0, toAgency: 0 });
    expect(assets.size).toBe(0);
    expect(stored.size).toBe(0);
    expect(await readdir(scratch)).toEqual([]);
  });

  it('reads the folder again once when a link has expired, and only once', async () => {
    holding(pick('image').ref.id);
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
    expect(await run(readWith(onceExpired))).toMatchObject({ stop: 'done', described: 1 });
    expect(refused).toBe(0);

    holding(pick('image').ref.id);
    assets = new Map();
    refused = 2;
    expect(await run(readWith(onceExpired))).toMatchObject({ stop: 'done', described: 0, skipped: 1 });
    expect(refused).toBe(0);
    expect([...refs.values()][0]).toMatchObject({ asset: null, failures: 0 });
    expect(await readdir(scratch)).toEqual([]);
  });

  it('leaves a file it does not read to the agency, never to the vision, and removes it all the same', async () => {
    holding(pick('video').ref.id);
    // A stream that is not one: the platform's bytes are written, then said to be a video ffmpeg cannot read.
    const garbage: VaultFileRead = async (ask) => {
      await writeFile(ask.path, new Uint8Array(4_096).fill(0x47));
      return { status: 'fetched', bytes: 4_096 };
    };
    expect(await run(garbage)).toMatchObject({ stop: 'done', toAgency: 1, described: 0 });
    expect(seen).toHaveLength(0);
    expect([...refs.values()][0]?.failures).toBe(DESCRIPTION_TRIES);
    expect(await run(garbage)).toMatchObject({ stop: 'done', toAgency: 0 });
    expect(await readdir(scratch)).toEqual([]);
  });

  it('removes the job’s folder when the storage of the picture fails, keeps nothing, and pays no description', async () => {
    holding(pick('image').ref.id);
    const failing = {
      ...deps(),
      picture: () => Promise.reject(new Error('storage unavailable')),
    };
    await expect(
      describeVault(failing, { platformAccountId: ACCOUNT, correlationId: 'test' }),
    ).rejects.toThrow('storage unavailable');
    // The picture comes before the vision: a storage that fails costs no description lost.
    expect(seen).toHaveLength(0);
    expect(assets.size).toBe(0);
    expect(await readdir(scratch)).toEqual([]);
  });

  it('keeps the media described, without a picture, when no storage is set', async () => {
    holding(pick('image').ref.id);
    const withoutStorage = {
      ...deps(),
      picture: (ask: { creatorId: string; sha256: string; path: string; kind: 'image' | 'video' }) =>
        pictureOf({ thumbnailer: createThumbnailer(), scratchDir: scratch, storage: null }, ask),
    };
    expect(
      await describeVault(withoutStorage, { platformAccountId: ACCOUNT, correlationId: 'test' }),
    ).toMatchObject({ stop: 'done', described: 1 });
    expect([...assets.values()][0]).toMatchObject({ thumbnailKey: null });
    expect([...assets.values()][0]?.described).not.toBeNull();
    expect(stored.size).toBe(0);
    expect(await readdir(scratch)).toEqual([]);
  });

  it('removes the picture of a media the vision cannot read, left to the agency', async () => {
    holding(pick('image').ref.id);
    const unreadable = {
      ...deps(),
      describer: { describe: () => Promise.resolve(err({ code: 'unreadable' as const })) },
    };
    expect(
      await describeVault(unreadable, { platformAccountId: ACCOUNT, correlationId: 'test' }),
    ).toMatchObject({ stop: 'done', toAgency: 1 });
    expect(stored.size).toBe(0);
    expect(await readdir(scratch)).toEqual([]);
  });

  it('removes the picture when the store fails after it, and the job fails to be replayed', async () => {
    holding(pick('image').ref.id);
    const failing = {
      ...deps(),
      store: { ...store, keep: () => Promise.reject(new Error('database gone')) },
    };
    await expect(
      describeVault(failing, { platformAccountId: ACCOUNT, correlationId: 'test' }),
    ).rejects.toThrow('database gone');
    expect(stored.size).toBe(0);
    expect(await readdir(scratch)).toEqual([]);
  });

  it('keeps the picture a media a fan sent already carries, the same key', async () => {
    holding(pick('image').ref.id);
    const fan = { ...deps(), store: { ...store, keep: () => Promise.resolve('fan' as const) } };
    expect(await describeVault(fan, { platformAccountId: ACCOUNT, correlationId: 'test' })).toMatchObject({
      stop: 'done',
      toAgency: 1,
    });
    expect(stored.size).toBe(1);
  });

  it('keeps the picture when a media of the same bytes was kept meanwhile, the same key', async () => {
    holding(pick('image').ref.id);
    vision.answer = 'budget';
    let asked = 0;
    const meanwhile = {
      ...deps(),
      store: {
        ...store,
        // First asked before the vision (nothing yet), then before the removal: a drop of the same bytes now.
        assetOf: (creatorId: string, sha256: string) =>
          ++asked === 1
            ? store.assetOf(creatorId, sha256)
            : Promise.resolve({ id: 'asset_drop', fromFan: false }),
      },
    };
    expect(
      await describeVault(meanwhile, { platformAccountId: ACCOUNT, correlationId: 'test' }),
    ).toMatchObject({ stop: 'budget' });
    expect(stored.size).toBe(1);
    expect(await readdir(scratch)).toEqual([]);
  });

  it('fails the job, never naming the key, when a picture kept by no media cannot be removed', async () => {
    holding(pick('image').ref.id);
    vision.answer = 'budget';
    const stuck = { ...deps(), unpicture: () => Promise.reject(new Error('storage refused')) };
    const run = describeVault(stuck, { platformAccountId: ACCOUNT, correlationId: 'test' });
    await expect(run).rejects.toBeInstanceOf(VaultPictureNotRemoved);
    await expect(run).rejects.not.toThrow(CREATOR);
    expect(stored.size).toBe(1);
    expect(await readdir(scratch)).toEqual([]);
  });

  it('describes the media of the scripts closest to proposable first', async () => {
    const photos = vault.filter((item) => item.kind === 'image' && item.folder !== null);
    const [first, second, third] = photos;
    if (first === undefined || second === undefined || third === undefined)
      throw new Error('three photos needed');
    holding(first.ref.id, second.ref.id, third.ref.id);
    scripts = [{ scriptId: 'script_x', active: true, platformMediaIds: [third.ref.id] }];
    vision.answer = 'budget';
    await run();
    vision.answer = 'ok';
    // One lot: the script's media goes first, the others (the same bytes) are linked to it.
    await run();
    expect(seen).toHaveLength(1);
    const thirdAsset = refs.get(`ref_${third.ref.id}`)?.asset;
    expect(thirdAsset).toBe('asset_1');
  });
});
