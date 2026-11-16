import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  CreatorIdSchema,
  err,
  newId,
  ok,
  PlatformAccountIdSchema,
  vaultDescribeJobKey,
  type CreatorId,
  type DropMediaDescription,
  type PlatformAccountId,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { LlmGateway } from '@impera/llm';
import { runOnce } from 'graphile-worker';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { revealApiConnectors } from '../modules/connectors';
import type { DropStorage } from '../modules/content-drops';

import { createFakeReveal, type FakeReveal } from './fake-reveal/server';
import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';

const SESSION_KEYS = `v1:${randomBytes(32).toString('base64')}`;

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

const vision = { calls: 0, budget: false };
const dropVision: Pick<LlmGateway, 'describeDrop' | 'transcribe' | 'promptHashes'> = {
  promptHashes: { creatorDrop: 'drop-v1', scriptSummary: 'summary-v1', scriptIdentity: 'identity-v1' },
  describeDrop: (input) => {
    // The day's cap spent: the gateway's own refusal, nothing called.
    if (vision.budget) return Promise.resolve(err({ code: 'budget_reached', attempts: [] }));
    vision.calls += 1;
    return Promise.resolve(
      ok({
        output: { ...DESCRIBED, kind: input.media.kind },
        meta: {
          provider: 'google',
          model: 'vision-test',
          isFallback: false,
          latencyMs: 1,
          promptHash: 'drop-v1',
        },
      }),
    );
  },
  // The stub never reads the video's frames nor its sound.
  transcribe: () => Promise.reject(new Error('not used')),
};

/** The media storage: only the reduced pictures may land here, never a vault file (ADR 0113 § 1). */
const STORED = new Map<string, Uint8Array>();
const unexpected = (what: string) => (): Promise<never> => Promise.reject(new Error(`${what} not expected`));
const storage: DropStorage = {
  openUpload: unexpected('openUpload'),
  startUpload: unexpected('startUpload'),
  storedParts: unexpected('storedParts'),
  partUrl: unexpected('partUrl'),
  completeUpload: unexpected('completeUpload'),
  sizeOf: unexpected('sizeOf'),
  remove: unexpected('remove'),
  download: unexpected('download'),
  read: unexpected('read'),
  upload: async (key, path) => {
    STORED.set(key, new Uint8Array(await readFile(path)));
  },
};

/**
 * `media.describe_vault` on FakeReveal's invented vault (ADR 0113), through the real connector, the real tables and the
 * worker: queued behind a vault sync, each photo and video read, described once per fingerprint by a stub vision, kept
 * born erased with its picture, the platform's text a row of its own; a spent budget stops the run and the hour's
 * catch-up resumes it without a double; the base refuses an empty key anywhere else.
 */
describe('vault description on FakeReveal (ADR 0113)', () => {
  let test: TestDb;
  let app: App;
  let fake: FakeReveal;
  let creatorId: CreatorId;
  let accountId: PlatformAccountId;
  let logger: ReturnType<typeof createLogger>;

  const sync = () =>
    app.modules.connectors.jobs.vaultSync(
      { creatorId, platformAccountId: accountId, correlationId: 'test' },
      logger,
    );
  const work = () =>
    runOnce({
      pgPool: test.admin.pool,
      taskList: {
        'media.describe_vault': app.tasks['media.describe_vault'],
        'media.describe_vault_backlog': app.tasks['media.describe_vault_backlog'],
      },
    });
  const queued = async () =>
    z.array(z.object({ queue: z.string().nullable(), run_at: z.coerce.date() })).parse(
      (
        await test.admin.db.execute(sql`
            select q.queue_name as queue, j.run_at
              from graphile_worker._private_jobs j
              join graphile_worker._private_tasks t on t.id = j.task_id
              left join graphile_worker._private_job_queues q on q.id = j.job_queue_id
             where t.identifier = 'media.describe_vault' and j.key = ${vaultDescribeJobKey(accountId)}`)
      ).rows,
    );
  const refs = () =>
    test.admin.db
      .select({
        id: schema.mediaPlatformRefs.platformMediaId,
        kind: schema.mediaPlatformRefs.kind,
        asset: schema.mediaPlatformRefs.mediaAssetId,
        failures: schema.mediaPlatformRefs.descriptionFailures,
      })
      .from(schema.mediaPlatformRefs)
      .where(eq(schema.mediaPlatformRefs.platformAccountId, accountId));

  beforeAll(async () => {
    fake = createFakeReveal();
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_SERVICE_URL: test.serviceUrl,
      SESSION_ENCRYPTION_KEYS: SESSION_KEYS,
    });
    logger = createLogger(config);
    const now = new Date(fake.state().now);
    app = await createApp(config, logger, {
      composer: fixedComposer,
      connectorsClock: () => now,
      connectorRegistry: {
        reveal: revealApiConnectors({
          fetch: fake.fetch,
          baseUrl: 'https://reveal.test',
          files: { transport: fake.fileTransport, hosts: ['fake-reveal.test'], httpForTests: true },
        }),
      },
      dropVision,
      dropStorage: storage,
    });
    creatorId = newId(CreatorIdSchema);
    await test.admin.db.insert(schema.creators).values({
      id: creatorId,
      nameKey: 'nora',
      displayName: 'Nora',
      timezone: 'Europe/Paris',
      // Her switch of the descriptions (ADR 0083 § 9): on, or nothing is described.
      settings: { describeDrops: true },
    });
    accountId = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.platformAccounts).values({
      id: accountId,
      creatorId,
      platform: 'reveal',
      handle: 'creatrice_test',
      sessionState: 'none',
    });
    await app.modules.connectors.sessions.store({
      platformAccountId: accountId,
      session: JSON.stringify({
        v: 1,
        bearer: fake.authorization.slice('Bearer '.length),
        userId: fake.userId,
        modelId: fake.modelId,
        userAgent: 'Mozilla/5.0 (test)',
        capturedAt: '2026-10-01T00:00:00.000Z',
      }),
      correlationId: 'test',
      userId: null,
    });
    // A photo with the platform's own text (invented), and a voice note, which is never read.
    fake.state().media.push(
      {
        id: 'vault_with_text',
        type: 'photo',
        folderId: 'folder_1',
        fromFanId: null,
        durationSeconds: null,
        createdAt: '2027-01-01T00:00:30.000Z',
        description: 'Texte inventé du coffre',
      },
      {
        id: 'vault_voice',
        type: 'audio',
        folderId: 'folder_3',
        fromFanId: null,
        durationSeconds: 8,
        createdAt: '2027-01-01T00:00:40.000Z',
      },
    );
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
    await fake.app.close();
  });

  it('is queued on the account’s queue behind a sync, once', async () => {
    await sync();
    await sync();
    const jobs = await queued();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.queue).toBe(`account:${accountId}`);
  });

  it('stops at the spent budget, keeps nothing, and is put off an hour', async () => {
    vision.budget = true;
    const before = Date.now();
    await work();
    vision.budget = false;
    expect((await refs()).every((ref) => ref.asset === null && ref.failures === 0)).toBe(true);
    const [job] = await queued();
    expect(job?.run_at.getTime()).toBeGreaterThan(before + 50 * 60_000);
    expect(STORED.size).toBe(0);
    const assets = await test.admin.db.select().from(schema.mediaAssets);
    expect(assets).toHaveLength(0);
  });

  it('describes each fingerprint once, keeps it born erased with its picture, and links every other media', async () => {
    // The hour's catch-up: a run already waiting keeps its time, so the test brings it forward as the hour would.
    await test.admin.db.execute(
      sql`update graphile_worker._private_jobs set run_at = now() where key = ${vaultDescribeJobKey(accountId)}`,
    );
    for (let lot = 0; lot < 10 && (await queued()).length > 0; lot++) await work();

    const all = await refs();
    const voice = all.find((ref) => ref.id === 'vault_voice');
    expect(voice?.asset).toBeNull();
    const media = all.filter((ref) => ref.kind !== 'audio');
    expect(media.every((ref) => ref.asset !== null)).toBe(true);

    // FakeReveal serves every photo with the same bytes, and every video with the same stream: two files in all.
    expect(vision.calls).toBe(2);
    const assets = await test.admin.db
      .select({
        id: schema.mediaAssets.id,
        kind: schema.mediaAssets.kind,
        origin: schema.mediaAssets.origin,
        storageKey: schema.mediaAssets.storageKey,
        erasedAt: schema.mediaAssets.erasedAt,
        thumbnailKey: schema.mediaAssets.thumbnailKey,
        sha256: schema.mediaAssets.sha256,
        durationMs: schema.mediaAssets.durationMs,
      })
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.creatorId, creatorId));
    expect(assets.map((asset) => asset.kind).sort()).toEqual(['image', 'video']);
    for (const asset of assets) {
      expect(asset).toMatchObject({ origin: 'vault', storageKey: '' });
      expect(asset.erasedAt).not.toBeNull();
      expect(asset.thumbnailKey).toBe(`thumbnails/${creatorId}/${asset.sha256}.jpg`);
    }
    expect(assets.find((asset) => asset.kind === 'video')?.durationMs).toBeGreaterThan(1_500);
    // Nothing but the two pictures reached the storage.
    expect([...STORED.keys()].sort()).toEqual(assets.map((asset) => asset.thumbnailKey).sort());

    const descriptions = await test.admin.db
      .select({
        author: schema.mediaDescriptions.author,
        content: schema.mediaDescriptions.content,
        validatedAt: schema.mediaDescriptions.validatedAt,
      })
      .from(schema.mediaDescriptions)
      .where(eq(schema.mediaDescriptions.creatorId, creatorId));
    expect(descriptions.filter((row) => row.author === 'sense')).toHaveLength(2);
    // The platform's text: a row of its own, never validated, never a description the scripts read (no `detailed`).
    expect(descriptions.filter((row) => row.author === 'platform')).toEqual([
      { author: 'platform', content: { platformText: 'Texte inventé du coffre' }, validatedAt: null },
    ]);
  });

  it('takes nothing again: a later sync and the hour’s catch-up describe nothing more', async () => {
    const calls = vision.calls;
    await sync();
    for (let lot = 0; lot < 3 && (await queued()).length > 0; lot++) await work();
    // A photo at the vault's root is never described (Charles, 16/11): the hour's catch-up
    // queues nothing for it.
    await test.admin.db.execute(sql`
      insert into media_platform_refs
        (id, creator_id, platform, platform_account_id, platform_media_id, kind, folder_ref, folder_position,
         platform_created_at, last_synced_at)
      values (gen_random_uuid(), ${creatorId}, 'reveal', ${accountId}, 'vault_root_loose', 'image', null, 0,
              '2027-01-01T00:00:50.000Z', now())`);
    await test.admin.db.execute(
      sql`select public.enqueue_job(task => 'media.describe_vault_backlog', payload => '{}'::jsonb)`,
    );
    // The catch-up alone: a run it queued would wait here.
    await runOnce({
      pgPool: test.admin.pool,
      taskList: { 'media.describe_vault_backlog': app.tasks['media.describe_vault_backlog'] },
    });
    expect(await queued()).toHaveLength(0);
    expect(vision.calls).toBe(calls);
    expect((await refs()).find((ref) => ref.id === 'vault_root_loose')).toMatchObject({
      asset: null,
      failures: 0,
    });
  });

  it('refuses an empty key anywhere but a vault media born erased (ADR 0113 § 1)', async () => {
    const insert = (origin: 'creator' | 'vault', storageKey: string, erased: boolean) =>
      test.admin.db.execute(sql`
        insert into media_assets (id, creator_id, kind, origin, storage_key, mime, bytes, sha256, erased_at)
        values (gen_random_uuid(), ${creatorId}, 'image', ${origin}, ${storageKey}, 'image/png', 1,
                ${randomBytes(32).toString('hex')}, ${erased ? sql`now()` : sql`null`})`);
    await expect(insert('creator', '', true)).rejects.toThrow();
    await expect(insert('vault', '', false)).rejects.toThrow();
    await expect(insert('vault', 'creators/x/y', true)).rejects.toThrow();
    await expect(insert('vault', '', true)).resolves.toBeDefined();
  });
});
