import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  err,
  ok,
  type DropMediaDescription,
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ContentDropSchema,
  CreatorContentSchema,
  ContentRequestIdSchema,
  CreatorIdSchema,
  DROP_PART_BYTES,
  DROP_KEPT_DAYS,
  DESCRIPTION_TRIES,
  DropDescriptionsReviewSchema,
  DropFileUploadSchema,
  JOB_PAYLOADS,
  newId,
  TeamMemberIdSchema,
  type CreatorId,
} from '@impera/contracts';
import { and, eq, inArray, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { DropSenseInput, LlmGateway } from '@impera/llm';
import { AwsClient } from 'aws4fetch';
import { strFromU8, unzipSync } from 'fflate';
import { runOnce } from 'graphile-worker';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { createDrizzleRetentionStore } from '../modules/content-drops/infra/db/retention-store';
import { createDrizzleReceiptStore } from '../modules/content-drops/infra/db/store';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** A day ahead of the server's real clock: a request is never asked for a day already past (recette MED-10). */
const DUE_ON = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

/**
 * Her files sent straight to the media storage (CR-06 b, ADR 0055 § 3), against a real object store: MinIO in a
 * container, or the server named by `IMPERA_TEST_S3_URL` where Docker is not available (its user in
 * `IMPERA_TEST_S3_USER` and `IMPERA_TEST_S3_PASSWORD`). Each part goes up to the address the API signed, the send
 * resumes after a cut, and the receipt job receives the file, cleans it (no position, no device left), keeps it in her
 * library or finds it a duplicate, and erases the raw bytes. Invented data only (ADR 0010).
 */
const IMAGE = 'coollabsio/minio:RELEASE.2025-10-15T17-29-55Z';
const USER = process.env['IMPERA_TEST_S3_USER'] ?? 'impera-test';
const PASSWORD = process.env['IMPERA_TEST_S3_PASSWORD'] ?? 'impera-test-password';
const REGION = 'us-east-1';
const ACCOUNT_PASSWORD = 'correct horse battery';
const PARIS = 'Europe/Paris';
const MB = 1024 * 1024;
const DEVICE = 'Telephone Invente 9';
const PLACE = '48.8566N 2.3522E';

const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
/**
 * A JPEG of exactly `bytes` bytes, `width` × `height`, with the EXIF a phone writes (an invented device and a position
 * as text): the cleaning follows its markers, never decodes it. `seed` makes two photos of one size differ.
 */
function jpegOf(bytes: number, width = 30, height = 40, seed = 0x11): Uint8Array {
  const text = (value: string): number[] => [...Buffer.from(value, 'latin1')];
  const segment = (marker: number, payload: number[]): number[] => [
    0xff,
    marker,
    ...be16(payload.length + 2),
    ...payload,
  ];
  const exif = segment(0xe1, [
    ...text('Exif\0\0MM'),
    0,
    0x2a,
    0,
    0,
    0,
    8,
    0,
    0,
    0,
    0,
    0,
    0,
    ...text(`${DEVICE} ${PLACE}`),
  ]);
  const head = [
    0xff,
    0xd8,
    ...exif,
    ...segment(0xc0, [8, ...be16(height), ...be16(width), 1, 1, 0x11, 0]),
    ...segment(0xda, [1, 1, 0, 0, 63, 0]),
  ];
  const out = new Uint8Array(bytes).fill(seed);
  out.set(head);
  out.set([0xff, 0xd9], bytes - 2);
  return out;
}
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * The vision AI of her drops (ADR 0083), with a fixed answer: invented, and another person seen, which the code must
 * hold back whatever the model says.
 */
const DESCRIBED: DropMediaDescription = {
  vocabularyVersion: '1.0.0',
  kind: 'image',
  detailed:
    'Photo inventée : une silhouette debout près d’une fenêtre, une seconde personne au fond de la pièce.',
  factualDescription: 'Une silhouette près d’une fenêtre.',
  durationS: null,
  segments: [],
  intensity: 'soft',
  anatomyVisible: [],
  castMode: 'duo',
  mood: [],
  setting: null,
  audio: null,
  textVisible: null,
  quality: 'good',
  confidenceLow: false,
  notVisible: false,
  flags: [],
};
const seen: DropSenseInput[] = [];
const vision = { fails: false };
const dropVision: Pick<LlmGateway, 'describeDrop' | 'transcribe' | 'promptHashes'> = {
  promptHashes: { creatorDrop: 'drop-v1', scriptSummary: 'summary-v1' },
  describeDrop: (input) => {
    seen.push(input);
    // Every model failing (a refusal of adult content, an outage): the gateway's own error.
    if (vision.fails) return Promise.resolve(err({ code: 'all_models_failed', attempts: [] }));
    return Promise.resolve(
      ok({
        output: DESCRIBED,
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
  transcribe: () => Promise.reject(new Error('a photo has no sound')),
};

describe('/v1/…/drops/:id/files/:fileId: her bytes to the media storage', () => {
  let container: StartedTestContainer | undefined;
  let endpoint = process.env['IMPERA_TEST_S3_URL'] ?? '';
  const bucket = `medias-${String(Date.now())}`;
  const s3 = new AwsClient({ accessKeyId: USER, secretAccessKey: PASSWORD, service: 's3', region: REGION });
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  const cookies: Record<'nora' | 'ines' | 'manager' | 'chatter', string> = {
    nora: '',
    ines: '',
    manager: '',
    chatter: '',
  };
  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, who: keyof typeof cookies, body?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie: cookies[who], origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, {
      email,
      name: email,
      password: ACCOUNT_PASSWORD,
    });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(server, email, ACCOUNT_PASSWORD) };
  }

  beforeAll(async () => {
    if (endpoint === '') {
      container = await new GenericContainer(IMAGE)
        .withEnvironment({ MINIO_ROOT_USER: USER, MINIO_ROOT_PASSWORD: PASSWORD })
        .withCommand(['server', '/data'])
        .withExposedPorts(9000)
        .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
        .start();
      endpoint = `http://${container.getHost()}:${String(container.getMappedPort(9000))}`;
    }
    const created = await s3.fetch(`${endpoint}/${bucket}`, { method: 'PUT' });
    expect(created.status, await created.text()).toBe(200);

    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      S3_ENDPOINT: endpoint,
      S3_REGION: REGION,
      S3_BUCKET: bucket,
      S3_ACCESS_KEY_ID: USER,
      S3_SECRET_ACCESS_KEY: PASSWORD,
    });
    app = await createApp(config, createLogger(config), { dropVision });
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    nora = newId(CreatorIdSchema);
    const ines = newId(CreatorIdSchema);
    for (const [id, label] of [
      [nora, 'Nora'],
      [ines, 'Ines'],
    ] as const)
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: PARIS });
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: ACCOUNT_PASSWORD,
    });
    for (const teamRole of ['manager', 'chatter'] as const) {
      // Both creators are on his list: a manager reaches only those (recette 05/11, reco 8).
      const member = await account(`${teamRole}@example.test`, {
        role: 'operator',
        creatorIds: [nora, ines],
      });
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId: member.userId,
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${teamRole}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
      cookies[teamRole] = member.cookie;
    }
    cookies.nora = (await account('nora@example.test', { role: 'creator', creatorIds: [nora] })).cookie;
    cookies.ines = (await account('ines@example.test', { role: 'creator', creatorIds: [ines] })).cookie;
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
    await container?.stop();
  });

  /** A drop of one photo, by her or by the manager for her, in `category`; its file and the file's bytes. */
  async function dropOne(
    who: 'nora' | 'manager',
    photo: Uint8Array,
    category: 'feed_shoot' | 'instagram_story' = 'feed_shoot',
    mime = 'image/jpeg',
  ) {
    const file = { id: newId(ContentDropFileIdSchema), mime, bytes: photo.length };
    const drop = { id: newId(ContentDropIdSchema), category, files: [file] };
    const url = who === 'nora' ? '/v1/creator-space/drops' : `/v1/creators/${nora}/drops`;
    const response = await call('POST', url, who, drop);
    expect(response.statusCode, response.body).toBe(200);
    const base =
      who === 'nora'
        ? `/v1/creator-space/drops/${drop.id}/files/${file.id}`
        : `/v1/creators/${nora}/drops/${drop.id}/files/${file.id}`;
    return { dropId: drop.id, fileId: file.id, bytes: photo, base };
  }

  async function upload(base: string, who: keyof typeof cookies) {
    const response = await call('POST', `${base}/upload`, who);
    expect(response.statusCode, response.body).toBe(200);
    return DropFileUploadSchema.parse(response.json());
  }

  /** A part sent as her phone sends it: a bare PUT to the signed address, no credentials. */
  async function put(url: string, body: Uint8Array): Promise<Response> {
    return fetch(url, { method: 'PUT', body });
  }

  const sliceOf = (bytes: Uint8Array, number: number): Uint8Array =>
    bytes.subarray((number - 1) * DROP_PART_BYTES, Math.min(bytes.length, number * DROP_PART_BYTES));

  const receive = () =>
    runOnce({
      pgPool: test.admin.pool,
      taskList: { 'content_drops.receive_file': app.tasks['content_drops.receive_file'] },
    });

  /** The trend watch's announcement of a drop (VEI-01 d3), as the worker would read it. */
  const dropReceivedJobs = async (dropId: string) => {
    const result = await test.admin.db.execute(sql`
      select j.payload from graphile_worker._private_jobs j
        join graphile_worker._private_tasks t on t.id = j.task_id
       where t.identifier = 'content_drops.drop_received'
         and j.key = ${`content_drops.drop_received:${dropId}`}`);
    return z
      .array(z.object({ payload: JOB_PAYLOADS['content_drops.drop_received'] }))
      .parse(result.rows)
      .map((row) => row.payload);
  };

  const rows = async (dropId: string) => {
    const [drop] = await test.admin.db
      .select({ state: schema.contentDrops.state })
      .from(schema.contentDrops)
      .where(eq(schema.contentDrops.id, dropId));
    const files = await test.admin.db
      .select({ state: schema.contentDropFiles.state, refusal: schema.contentDropFiles.refusal })
      .from(schema.contentDropFiles)
      .where(eq(schema.contentDropFiles.dropId, dropId));
    return { drop: drop?.state, files };
  };

  it('sends her photo in parts, resumes after a cut; the job cleans it, keeps it, erases the raw bytes', async () => {
    const { dropId, fileId, base, bytes } = await dropOne('nora', jpegOf(9 * MB));
    const first = await upload(base, 'nora');
    expect(first).toMatchObject({ sent: false, partBytes: DROP_PART_BYTES, stored: [] });
    expect(first.missing.map((part) => [part.number, part.bytes])).toEqual([
      [1, DROP_PART_BYTES],
      [2, MB],
    ]);
    // The first part goes up, then the phone loses the network.
    const one = await put(first.missing[0]?.url ?? '', sliceOf(bytes, 1));
    expect(one.status, await one.text()).toBe(200);
    const etag = one.headers.get('etag') ?? '';
    // Asked again, the API names only the part still missing, and the one held with its ETag.
    const resumed = await upload(base, 'nora');
    expect(resumed.missing.map((part) => part.number)).toEqual([2]);
    expect(resumed.stored).toEqual([{ number: 1, etag }]);
    const two = await put(resumed.missing[0]?.url ?? '', sliceOf(bytes, 2));
    expect(two.status).toBe(200);
    const parts = [
      { number: 1, etag },
      { number: 2, etag: two.headers.get('etag') ?? '' },
    ];
    const done = await call('POST', `${base}/complete`, 'nora', { parts });
    expect(done.statusCode, done.body).toBe(200);
    expect(ContentDropSchema.parse(done.json()).files[0]?.state).toBe('awaiting');
    // Whole in the storage, under its raw prefix: nothing left to send.
    expect((await upload(base, 'nora')).sent).toBe(true);
    await receive();
    expect(await rows(dropId)).toEqual({ drop: 'ready', files: [{ state: 'kept', refusal: null }] });
    // In her library under its fingerprint, the cleaned bytes: no device, no position; the raw bytes gone.
    const [medium] = await test.admin.db
      .select()
      .from(schema.mediaAssets)
      .where(eq(schema.mediaAssets.creatorId, nora));
    expect(medium).toMatchObject({ kind: 'image', origin: 'creator', mime: 'image/jpeg' });
    expect(medium?.storageKey).toBe(`media/${nora}/${medium?.sha256 ?? ''}`);
    const stored = await s3.fetch(`${endpoint}/${bucket}/${medium?.storageKey ?? ''}`);
    expect(stored.status).toBe(200);
    const kept = new Uint8Array(await stored.arrayBuffer());
    expect(sha(kept)).toBe(medium?.sha256);
    expect(kept.length).toBe(medium?.bytes);
    expect(Buffer.from(kept).toString('latin1')).not.toContain(DEVICE);
    expect(Buffer.from(kept).toString('latin1')).not.toContain(PLACE);
    expect(Buffer.from(bytes).toString('latin1')).toContain(PLACE);
    const raw = await s3.fetch(`${endpoint}/${bucket}/incoming/${nora}/${fileId}`, { method: 'HEAD' });
    expect(raw.status).toBe(404);
    // Once per drop, for the trend watch (VEI-01 d): the request that asked for it, none here.
    const events = await test.admin.db
      .select({ creatorId: schema.domainEvents.creatorId, payload: schema.domainEvents.payload })
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.type, 'content_drop_received'));
    expect(events).toEqual([{ creatorId: nora, payload: { dropId, requestId: null } }]);
    // A drop that answers no request announces nothing to the trend watch (VEI-01 d3).
    expect(await dropReceivedJobs(dropId)).toEqual([]);
    // Replayed once kept, « complete » answers the drop as it is.
    const replay = await call('POST', `${base}/complete`, 'nora', { parts });
    expect(replay.statusCode).toBe(200);
    expect(ContentDropSchema.parse(replay.json())).toMatchObject({ state: 'ready' });
    expect((await upload(base, 'nora')).sent).toBe(true);
  });

  it('announces once to the trend watch a drop that answers a content request (VEI-01 d3)', async () => {
    const requestId = newId(ContentRequestIdSchema);
    await test.admin.db.insert(schema.contentRequests).values({
      id: requestId,
      creatorId: nora,
      category: 'feed_shoot',
      dueOn: DUE_ON,
      reason: 'Idée inventée',
      structureId: null,
      origin: 'idea',
      createdBy: null,
    });
    const photo = jpegOf(MB, 40, 30, 0x55);
    const file = { id: newId(ContentDropFileIdSchema), mime: 'image/jpeg', bytes: photo.length };
    const dropId = newId(ContentDropIdSchema);
    const created = await call('POST', '/v1/creator-space/drops', 'nora', {
      id: dropId,
      category: 'feed_shoot',
      requestId,
      files: [file],
    });
    expect(created.statusCode, created.body).toBe(200);
    await sendWhole({ base: `/v1/creator-space/drops/${dropId}/files/${file.id}`, bytes: photo });
    await receive();
    expect(await dropReceivedJobs(dropId)).toEqual([{ creatorId: nora, dropId, requestId }]);
  });

  it('signs each address for its part’s exact size: a part cut otherwise is refused by the storage', async (context) => {
    // A store that does not check presigned signatures (moto, for the runs without Docker) cannot say it.
    if (process.env['IMPERA_TEST_S3_CHECKS_SIGNATURES'] === 'false') context.skip();
    const { base, bytes } = await dropOne('nora', jpegOf(9 * MB));
    const plan = await upload(base, 'nora');
    const shorter = await put(plan.missing[0]?.url ?? '', bytes.subarray(0, MB));
    expect(shorter.status).toBe(403);
    const tampered = new URL(plan.missing[1]?.url ?? '');
    tampered.searchParams.set('partNumber', '3');
    expect((await put(tampered.toString(), sliceOf(bytes, 2))).status).toBe(403);
  });

  it('refuses « complete » without every part, and a file whose stored size is not the one declared', async () => {
    const { dropId, fileId, base, bytes } = await dropOne('nora', jpegOf(9 * MB));
    const plan = await upload(base, 'nora');
    const sent = await put(plan.missing[0]?.url ?? '', sliceOf(bytes, 1));
    const partial = await call('POST', `${base}/complete`, 'nora', {
      parts: [{ number: 1, etag: sent.headers.get('etag') ?? '' }],
    });
    expect(partial.statusCode).toBe(422);
    expect(partial.json()).toMatchObject({
      error: {
        code: 'content_drop_upload_unprocessable',
        message: 'Il manque une partie du fichier : relance l’envoi',
      },
    });
    // Bytes of another size under its raw key (a store that let a part grow): erased, and refused to her.
    const key = `incoming/${nora}/${fileId}`;
    const planted = await s3.fetch(`${endpoint}/${bucket}/${key}`, { method: 'PUT', body: randomBytes(MB) });
    expect(planted.status).toBe(200);
    const wrong = await call('POST', `${base}/complete`, 'nora', {
      parts: [
        { number: 1, etag: 'a' },
        { number: 2, etag: 'b' },
      ],
    });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json()).toMatchObject({
      error: { message: 'Le fichier reçu n’a pas la taille annoncée : relance l’envoi' },
    });
    expect((await s3.fetch(`${endpoint}/${bucket}/${key}`, { method: 'HEAD' })).status).toBe(404);
    expect(await rows(dropId)).toEqual({ drop: 'uploading', files: [{ state: 'awaiting', refusal: null }] });
  });

  it('opens her file to her and to the agency, never to another creator nor a chatter', async () => {
    const mine = await dropOne('nora', jpegOf(MB, 30, 40, 0x22));
    const ines = await call(
      'POST',
      `/v1/creator-space/drops/${mine.dropId}/files/${mine.fileId}/upload`,
      'ines',
    );
    expect(ines.statusCode).toBe(404);
    expect(ines.json()).toMatchObject({ error: { code: 'content_drop_not_found' } });
    const other = await call(
      'POST',
      `/v1/creator-space/drops/${mine.dropId}/files/${newId(ContentDropFileIdSchema)}/upload`,
      'nora',
    );
    expect(other.json()).toMatchObject({ error: { code: 'content_drop_file_not_found' } });
    const theirs = await dropOne('manager', jpegOf(MB, 30, 40, 0x33));
    const chatter = await call('POST', `${theirs.base}/upload`, 'chatter');
    expect(chatter.statusCode).toBe(403);
    // The manager sends the file of the drop the agency made for her, in one part.
    const plan = await upload(theirs.base, 'manager');
    expect(plan.missing).toHaveLength(1);
    const sent = await put(plan.missing[0]?.url ?? '', theirs.bytes);
    const done = await call('POST', `${theirs.base}/complete`, 'manager', {
      parts: [{ number: 1, etag: sent.headers.get('etag') ?? '' }],
    });
    expect(done.statusCode, done.body).toBe(200);
    await receive();
    expect((await rows(theirs.dropId)).drop).toBe('ready');
  });

  /** Her file sent whole in one part and « complete » called, as her phone does for a small photo. */
  async function sendWhole(
    one: { readonly base: string; readonly bytes: Uint8Array },
    who: 'nora' | 'manager' = 'nora',
  ) {
    const plan = await upload(one.base, who);
    const sent = await put(plan.missing[0]?.url ?? '', one.bytes);
    const done = await call('POST', `${one.base}/complete`, who, {
      parts: [{ number: 1, etag: sent.headers.get('etag') ?? '' }],
    });
    expect(done.statusCode, done.body).toBe(200);
  }

  it('finds a photo she already gave a duplicate, and refuses a landscape story with her sentence', async () => {
    const photo = jpegOf(MB, 30, 40, 0x44);
    const first = await dropOne('nora', photo);
    await sendWhole(first);
    await receive();
    const again = await dropOne('nora', photo);
    await sendWhole(again);
    await receive();
    expect(await rows(again.dropId)).toEqual({
      drop: 'ready',
      files: [{ state: 'duplicate', refusal: null }],
    });
    // Both files name the one medium of her library.
    const media = await test.admin.db
      .select({ id: schema.contentDropFiles.mediaAssetId })
      .from(schema.contentDropFiles)
      .where(inArray(schema.contentDropFiles.id, [first.fileId, again.fileId]));
    expect(new Set(media.map((one) => one.id)).size).toBe(1);

    // 40 wide, 30 high: a story stands upright.
    const story = await dropOne('nora', jpegOf(MB, 40, 30, 0x55), 'instagram_story');
    await sendWhole(story);
    await receive();
    expect(await rows(story.dropId)).toEqual({
      drop: 'blocked',
      files: [{ state: 'refused', refusal: '« Story Insta » : la photo doit être verticale' }],
    });
    // Bytes that are no photo, under a photo's name.
    const fake = randomBytes(MB);
    const renamed = await dropOne('nora', fake);
    await sendWhole(renamed);
    await receive();
    expect((await rows(renamed.dropId)).files).toEqual([
      { state: 'refused', refusal: 'Ce fichier n’est pas ce qu’il annonce : renvoie-le depuis ta galerie' },
    ]);
  });

  it('describes a new photo of hers once her switch is on, once, and holds back another person (ADR 0083)', async () => {
    const one = await dropOne('nora', jpegOf(MB, 30, 40, 0x5a));
    await sendWhole(one);
    await receive();
    const [file] = await test.admin.db
      .select({ mediaAssetId: schema.contentDropFiles.mediaAssetId })
      .from(schema.contentDropFiles)
      .where(eq(schema.contentDropFiles.id, one.fileId));
    const mediaAssetId = file?.mediaAssetId ?? '';
    // Enqueued with the medium it kept, once, under its key.
    const queued = await test.admin.db.execute(sql`
      select j.payload from graphile_worker._private_jobs j
        join graphile_worker._private_tasks t on t.id = j.task_id
       where t.identifier = 'content_drops.describe_file' and j.key = ${`content_drops.describe_file:${mediaAssetId}`}`);
    expect(
      z.array(z.object({ payload: JOB_PAYLOADS['content_drops.describe_file'] })).parse(queued.rows),
    ).toMatchObject([{ payload: { creatorId: nora, mediaAssetId } }]);
    const describe = () =>
      runOnce({
        pgPool: test.admin.pool,
        taskList: { 'content_drops.describe_file': app.tasks['content_drops.describe_file'] },
      });
    const again = () =>
      test.admin.db.execute(sql`select public.enqueue_job(
        task => 'content_drops.describe_file',
        payload => ${JSON.stringify({ creatorId: nora, mediaAssetId, correlationId: 'test' })}::jsonb
      )`);
    const descriptions = () =>
      test.admin.db
        .select({
          author: schema.mediaDescriptions.author,
          content: schema.mediaDescriptions.content,
          model: schema.mediaDescriptions.model,
          reviewReasons: schema.mediaDescriptions.reviewReasons,
        })
        .from(schema.mediaDescriptions)
        .where(eq(schema.mediaDescriptions.mediaAssetId, mediaAssetId));

    // Her switch off (ADR 0083 § 9): the vision AI is never called.
    seen.length = 0;
    await describe();
    expect(seen).toEqual([]);
    expect(await descriptions()).toEqual([]);

    await test.admin.db
      .update(schema.creators)
      .set({ settings: { describeDrops: true } })
      .where(eq(schema.creators.id, nora));
    await again();
    await describe();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.context).toEqual({ category: 'Feed · Séance boudoir', step: null });
    expect(seen[0]?.trace).toEqual({ creatorId: nora });
    expect(seen[0]?.media).toMatchObject({ kind: 'image', mediaType: 'image/jpeg' });
    // Kept for the agency, held back: she always shoots alone (§ 4).
    expect(await descriptions()).toEqual([
      {
        author: 'sense',
        content: DESCRIBED,
        model: 'vision-test',
        reviewReasons: ['not_alone'],
      },
    ]);

    // Replayed, and given again in another drop: nothing called, nothing written twice.
    await again();
    await describe();
    const twice = await dropOne('nora', one.bytes);
    await sendWhole(twice);
    await receive();
    await describe();
    expect(seen).toHaveLength(1);
    expect(await descriptions()).toHaveLength(1);
    await test.admin.db.update(schema.creators).set({ settings: {} }).where(eq(schema.creators.id, nora));
  });

  it('gives a medium up after the vision’s tries, until her team asks again (recette créatrice, anomaly 2)', async () => {
    const one = await dropOne('nora', jpegOf(MB, 30, 40, 0x6b));
    await sendWhole(one);
    await receive();
    const [file] = await test.admin.db
      .select({ mediaAssetId: schema.contentDropFiles.mediaAssetId })
      .from(schema.contentDropFiles)
      .where(eq(schema.contentDropFiles.id, one.fileId));
    const mediaAssetId = file?.mediaAssetId ?? '';
    const failures = async () => {
      const [row] = await test.admin.db
        .select({ n: schema.mediaAssets.descriptionFailures })
        .from(schema.mediaAssets)
        .where(eq(schema.mediaAssets.id, mediaAssetId));
      return row?.n;
    };
    const queued = async () => {
      const rows = await test.admin.db.execute(sql`
        select j.attempts from graphile_worker._private_jobs j
          join graphile_worker._private_tasks t on t.id = j.task_id
         where t.identifier = 'content_drops.describe_file' and j.key = ${`content_drops.describe_file:${mediaAssetId}`}`);
      return rows.rows.length;
    };
    const describe = () =>
      runOnce({
        pgPool: test.admin.pool,
        taskList: { 'content_drops.describe_file': app.tasks['content_drops.describe_file'] },
      });
    const backlog = async () => {
      await test.admin.db.execute(
        sql`select public.enqueue_job(task => 'content_drops.describe_backlog', payload => '{}'::jsonb)`,
      );
      await runOnce({
        pgPool: test.admin.pool,
        taskList: { 'content_drops.describe_backlog': app.tasks['content_drops.describe_backlog'] },
      });
    };
    const review = async () => {
      const answer = await call('GET', `/v1/creators/${nora}/drops/${one.dropId}/descriptions`, 'manager');
      expect(answer.statusCode, answer.body).toBe(200);
      return DropDescriptionsReviewSchema.parse(answer.json());
    };
    await test.admin.db
      .update(schema.creators)
      .set({ settings: { describeDrops: true } })
      .where(eq(schema.creators.id, nora));
    vision.fails = true;

    // A failed try is counted on the medium, and the job is tried again.
    await describe();
    expect(await failures()).toBe(1);
    expect(await queued()).toBe(1);
    expect((await review()).media[0]?.describeFailed).toBe(false);

    // The last try: given up, nothing waits any more, and the hourly backlog leaves it alone.
    await test.admin.db
      .update(schema.mediaAssets)
      .set({ descriptionFailures: DESCRIPTION_TRIES - 1 })
      .where(eq(schema.mediaAssets.id, mediaAssetId));
    await test.admin.db.execute(sql`update graphile_worker._private_jobs set run_at = now()`);
    await describe();
    expect(await failures()).toBe(DESCRIPTION_TRIES);
    expect(await queued()).toBe(0);
    await backlog();
    expect(await queued()).toBe(0);
    expect((await review()).media[0]).toMatchObject({ description: null, describeFailed: true });

    // Asked again by her team (a chatter and she cannot): counted from nothing, enqueued now, audited; described.
    const retry = (who: 'manager' | 'chatter' | 'nora') =>
      call('POST', `/v1/creators/${nora}/drops/${one.dropId}/files/${one.fileId}/describe`, who);
    expect((await retry('chatter')).statusCode).toBe(403);
    expect((await retry('nora')).statusCode).toBe(403);
    const asked = await retry('manager');
    expect(asked.statusCode, asked.body).toBe(200);
    expect(DropDescriptionsReviewSchema.parse(asked.json()).media[0]?.describeFailed).toBe(false);
    expect([await failures(), await queued()]).toEqual([0, 1]);
    vision.fails = false;
    await describe();
    expect((await review()).media[0]?.description?.author).toBe('sense');
    const [audited] = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'media_description.retried'));
    expect(audited).toBeDefined();
    await test.admin.db.update(schema.creators).set({ settings: {} }).where(eq(schema.creators.id, nora));
  });

  it('takes a description written by hand on a medium the AI gave up, its words and its level (recette créatrice, anomaly 2)', async () => {
    const one = await dropOne('nora', jpegOf(MB, 30, 40, 0x6c));
    await sendWhole(one);
    await receive();
    const [file] = await test.admin.db
      .select({ mediaAssetId: schema.contentDropFiles.mediaAssetId })
      .from(schema.contentDropFiles)
      .where(eq(schema.contentDropFiles.id, one.fileId));
    const mediaAssetId = file?.mediaAssetId ?? '';
    await test.admin.db
      .update(schema.mediaAssets)
      .set({ descriptionFailures: DESCRIPTION_TRIES })
      .where(eq(schema.mediaAssets.id, mediaAssetId));
    const write = (who: 'manager' | 'chatter' | 'nora', body: object) =>
      call('POST', `/v1/creators/${nora}/drops/${one.dropId}/files/${one.fileId}/description`, who, body);
    const words = 'Elle est assise au bord du lit, en nuisette noire, et regarde l’objectif en souriant.';

    // Her team's alone; a level a human who saw it never says is refused.
    expect((await write('chatter', { detailed: words, intensity: 'soft' })).statusCode).toBe(403);
    expect((await write('nora', { detailed: words, intensity: 'soft' })).statusCode).toBe(403);
    expect((await write('manager', { detailed: words, intensity: 'not_visible' })).statusCode).toBe(400);
    expect((await write('manager', { detailed: '   ', intensity: 'soft' })).statusCode).toBe(400);

    const written = await write('manager', { detailed: `  ${words} `, intensity: 'suggestive' });
    expect(written.statusCode, written.body).toBe(200);
    const medium = DropDescriptionsReviewSchema.parse(written.json()).media[0];
    expect(medium).toMatchObject({
      describeFailed: false,
      description: { author: 'hand', detailed: words },
    });
    expect(medium?.description?.validatedAt).not.toBeNull();

    // The level picked, every other label « not seen »; written once, audited.
    const [row] = await test.admin.db
      .select({ content: schema.mediaDescriptions.content, by: schema.mediaDescriptions.validatedBy })
      .from(schema.mediaDescriptions)
      .where(eq(schema.mediaDescriptions.mediaAssetId, mediaAssetId));
    expect(row?.by).not.toBeNull();
    expect(row?.content).toMatchObject({
      intensity: 'suggestive',
      castMode: 'not_visible',
      anatomyVisible: [],
      mood: [],
      flags: [],
      factualDescription: words,
    });
    const again = await write('manager', { detailed: words, intensity: 'soft' });
    expect(again.statusCode, again.body).toBe(409);
    const [audited] = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'media_description.written'));
    expect(audited).toBeDefined();

    // « Réessayer » has nothing left to ask: the medium is described.
    const retried = await call(
      'POST',
      `/v1/creators/${nora}/drops/${one.dropId}/files/${one.fileId}/describe`,
      'manager',
    );
    expect(DropDescriptionsReviewSchema.parse(retried.json()).media[0]?.description?.author).toBe('hand');
  });

  it('gives the agency her feed drop as a ZIP, then takes « Publié » once: her originals go 30 days later (recette créatrice, anomaly 1)', async () => {
    const one = await dropOne('nora', jpegOf(MB, 30, 40, 0x7d));
    const url = `/v1/creators/${nora}/drops/${one.dropId}/export`;
    // Still being sent: not yet.
    const early = await call('GET', url, 'manager');
    expect(early.statusCode, early.body).toBe(422);
    expect(early.json()).toMatchObject({ error: { details: { reason: 'not_ready' } } });
    await sendWhole(one);
    await receive();

    // Her team's alone.
    expect((await call('GET', url, 'chatter')).statusCode).toBe(403);
    expect((await call('GET', url, 'nora')).statusCode).toBe(403);
    expect((await call('POST', `${url}/confirm`, 'chatter')).statusCode).toBe(403);
    const archive = await call('GET', url, 'manager');
    expect(archive.statusCode, archive.body).toBe(200);
    expect(archive.headers['content-type']).toBe('application/zip');
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: PARIS }).format(new Date());
    const folder = `feed-seance-${day}`;
    expect(archive.headers['content-disposition']).toBe(`attachment; filename="${folder}.zip"`);
    const entries = unzipSync(new Uint8Array(archive.rawPayload));
    expect(Object.keys(entries)).toEqual([`${folder}/00-fiche.txt`, `${folder}/01-photo.jpg`]);
    const sheet = strFromU8(entries[`${folder}/00-fiche.txt`] ?? new Uint8Array());
    expect(sheet.split('\n').slice(0, 4)).toEqual([
      `Feed · Séance boudoir du ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: PARIS }).format(new Date())}`,
      '',
      'À publier sur son feed Reveal, en une seule publication, dans cet ordre.',
      '',
    ]);
    expect(sheet).toContain('01-photo.jpg');

    const before = Date.now();
    const confirmed = await call('POST', `${url}/confirm`, 'manager');
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const drop = ContentDropSchema.parse(confirmed.json());
    expect(drop.exportedAt).not.toBeNull();
    const [kept] = await test.admin.db
      .select({ expiresAt: schema.mediaAssets.expiresAt })
      .from(schema.contentDropFiles)
      .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, schema.contentDropFiles.mediaAssetId))
      .where(eq(schema.contentDropFiles.id, one.fileId));
    const days30 = 30 * 86_400_000;
    expect(kept?.expiresAt?.getTime()).toBeGreaterThanOrEqual(before + days30 - 1000);
    expect(kept?.expiresAt?.getTime()).toBeLessThanOrEqual(Date.now() + days30 + 1000);
    // Replayed: the same date, one audit line; she reads it out.
    const again = ContentDropSchema.parse((await call('POST', `${url}/confirm`, 'manager')).json());
    expect(again.exportedAt).toBe(drop.exportedAt);
    const audit = await test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, one.dropId));
    expect(audit.map((line) => line.details)).toEqual([
      expect.objectContaining({ category: 'feed_shoot', originals: 1 }),
    ]);
    const hers = CreatorContentSchema.parse((await call('GET', '/v1/creator-space/content', 'nora')).json());
    expect(hers.drops.find((mine) => mine.id === one.dropId)?.exportedAt).toBe(drop.exportedAt);
  });

  it('takes no more bytes once her drop is withdrawn, and the job erases what had arrived', async () => {
    const { dropId, fileId, base, bytes } = await dropOne('nora', jpegOf(MB, 30, 40, 0x22));
    const plan = await upload(base, 'nora');
    const sent = await put(plan.missing[0]?.url ?? '', bytes);
    const parts = [{ number: 1, etag: sent.headers.get('etag') ?? '' }];
    expect((await call('POST', `${base}/complete`, 'nora', { parts })).statusCode).toBe(200);
    expect((await call('DELETE', `/v1/creator-space/drops/${dropId}`, 'nora')).statusCode).toBe(204);
    const again = await call('POST', `${base}/upload`, 'nora');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'content_drop_file_settled_conflict' } });
    await receive();
    const key = `incoming/${nora}/${fileId}`;
    expect((await s3.fetch(`${endpoint}/${bucket}/${key}`, { method: 'HEAD' })).status).toBe(404);
    expect(await rows(dropId)).toEqual({ drop: 'withdrawn', files: [{ state: 'awaiting', refusal: null }] });
  });

  it('hands her WebM over to the conversion queue, which keeps it as an H.264 MP4 (ADR 0070)', async () => {
    // Two seconds of VP9 made by ffmpeg, tagged with an invented device: no real video.
    const dir = await mkdtemp(join(tmpdir(), 'impera-webm-'));
    const path = join(dir, 'clip.webm');
    await promisify(execFile)('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10', '-t', '2'],
      ...['-c:v', 'libvpx-vp9', '-b:v', '200k', '-metadata', `title=${DEVICE}`, path],
    ]);
    const webm = new Uint8Array(await readFile(path));
    await rm(dir, { recursive: true, force: true });
    const clip = await dropOne('nora', webm, 'feed_shoot', 'video/webm');
    await sendWhole(clip);
    await receive();
    // Received, not yet kept: the conversion waits in its own queue, one at a time.
    expect((await rows(clip.dropId)).files).toEqual([{ state: 'received', refusal: null }]);
    const queued = await test.admin.db.execute<{ task_identifier: string; queue_name: string | null }>(
      sql`select task_identifier, queue_name from graphile_worker.jobs where key = ${`content_drops.convert_file:${clip.fileId}`}`,
    );
    expect(queued.rows).toEqual([
      { task_identifier: 'content_drops.convert_file', queue_name: 'content_drops:convert' },
    ]);
    await runOnce({
      pgPool: test.admin.pool,
      taskList: { 'content_drops.convert_file': app.tasks['content_drops.convert_file'] },
    });
    expect(await rows(clip.dropId)).toEqual({ drop: 'ready', files: [{ state: 'kept', refusal: null }] });
    const medium = await mediumOf(clip.fileId);
    expect(medium).toMatchObject({ kind: 'video', mime: 'video/mp4', durationMs: 2000 });
    const stored = await s3.fetch(`${endpoint}/${bucket}/${medium.storageKey}`);
    const kept = Buffer.from(await stored.arrayBuffer());
    expect(kept.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expect(kept.toString('latin1').includes(DEVICE)).toBe(false);
    expect(await held(`incoming/${nora}/${clip.fileId}`)).toBe(404);
  });

  /** `content_drops.erase_originals` once, as the hourly cron would enqueue it (CR-06 c). */
  async function erase() {
    await test.admin.db.execute(
      sql`select graphile_worker.add_job('content_drops.erase_originals', '{}'::json)`,
    );
    await runOnce({
      pgPool: test.admin.pool,
      taskList: { 'content_drops.erase_originals': app.tasks['content_drops.erase_originals'] },
    });
  }

  const mediumOf = async (fileId: string) => {
    const [row] = await test.admin.db
      .select({ media: schema.mediaAssets })
      .from(schema.contentDropFiles)
      .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.id, schema.contentDropFiles.mediaAssetId))
      .where(eq(schema.contentDropFiles.id, fileId));
    if (row === undefined) throw new Error(`no medium for ${fileId}`);
    return row.media;
  };

  const eventsOf = async (mediaAssetId: string) =>
    (
      await test.admin.db
        .select({ type: schema.domainEvents.type, payload: schema.domainEvents.payload })
        .from(schema.domainEvents)
        .where(sql`${schema.domainEvents.payload}->>'mediaAssetId' = ${mediaAssetId}`)
        .orderBy(schema.domainEvents.createdAt)
    ).map((one) => one.type);

  const held = async (key: string) =>
    (await s3.fetch(`${endpoint}/${bucket}/${key}`, { method: 'HEAD' })).status;

  it('erases the reduced pictures of a creator archived 90 days ago, once, and keeps those of one archived since (ADR 0089)', async () => {
    const day = 86_400_000;
    const archived = async (label: string, daysAgo: number) => {
      const creatorId = newId(CreatorIdSchema);
      await test.admin.db.insert(schema.creators).values({
        id: creatorId,
        nameKey: creatorId,
        displayName: label,
        timezone: PARIS,
        archivedAt: new Date(Date.now() - daysAgo * day),
      });
      const thumbnailKey = `thumbnails/${creatorId}/1.jpg`;
      const put = await s3.fetch(`${endpoint}/${bucket}/${thumbnailKey}`, {
        method: 'PUT',
        body: jpegOf(1000, 30, 40, 0x5a),
      });
      expect(put.status).toBe(200);
      const [medium] = await test.admin.db
        .insert(schema.mediaAssets)
        .values({
          id: crypto.randomUUID(),
          creatorId,
          kind: 'image',
          origin: 'creator',
          storageKey: `creators/${creatorId}/1.jpg`,
          mime: 'image/jpeg',
          bytes: 1000,
          sha256: creatorId.replace(/-/gu, '').padEnd(64, '0'),
          erasedAt: new Date(Date.now() - 200 * day),
          thumbnailKey,
          thumbnailedAt: new Date(Date.now() - 300 * day),
        })
        .returning({ id: schema.mediaAssets.id });
      return { creatorId, thumbnailKey, mediaAssetId: medium?.id ?? '' };
    };
    const gone = await archived('Partie il y a longtemps', 91);
    const kept = await archived('Partie récemment', 89);
    const row = async (mediaAssetId: string) => {
      const [one] = await test.admin.db
        .select({ key: schema.mediaAssets.thumbnailKey, tried: schema.mediaAssets.thumbnailedAt })
        .from(schema.mediaAssets)
        .where(eq(schema.mediaAssets.id, mediaAssetId));
      return one;
    };
    const audit = (creatorId: string) =>
      test.admin.db
        .select({ details: schema.auditLog.details })
        .from(schema.auditLog)
        .where(
          and(eq(schema.auditLog.entityId, creatorId), eq(schema.auditLog.action, 'media.thumbnails_erased')),
        );

    await erase();
    expect(await held(gone.thumbnailKey)).toBe(404);
    // Never made again: its try stays.
    const erased = await row(gone.mediaAssetId);
    expect(erased?.key).toBeNull();
    expect(erased?.tried).toBeInstanceOf(Date);
    expect((await audit(gone.creatorId)).map((line) => line.details)).toEqual([{ count: 1 }]);
    expect(await held(kept.thumbnailKey)).toBe(200);
    expect((await row(kept.mediaAssetId))?.key).toBe(kept.thumbnailKey);
    expect(await audit(kept.creatorId)).toEqual([]);

    // Replayed: nothing more goes, nothing said twice.
    await erase();
    expect(await audit(gone.creatorId)).toHaveLength(1);
  });

  it('keeps an original a year, tells the agency 7 days before, erases it at its date, holds it again if given again', async () => {
    const photo = jpegOf(MB, 30, 40, 0x66);
    const first = await dropOne('nora', photo);
    await sendWhole(first);
    await receive();
    const medium = await mediumOf(first.fileId);
    // A year from its keeping (ADR 0055 § 7), while no exit is planned.
    const year = (medium.expiresAt?.getTime() ?? 0) - medium.createdAt.getTime();
    expect(Math.abs(year - DROP_KEPT_DAYS * 86_400_000)).toBeLessThan(60_000);
    await erase();
    expect(await eventsOf(medium.id)).toEqual([]);

    // Three days left: the agency is told, once however many runs.
    await test.admin.db
      .update(schema.mediaAssets)
      .set({ expiresAt: sql`now() + interval '3 days'` })
      .where(eq(schema.mediaAssets.id, medium.id));
    await erase();
    await erase();
    expect(await eventsOf(medium.id)).toEqual(['content_media_expiring']);
    expect(await held(medium.storageKey)).toBe(200);

    // Its date passed: erased from the storage, the row kept with its fingerprint.
    await test.admin.db
      .update(schema.mediaAssets)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(schema.mediaAssets.id, medium.id));
    await erase();
    await erase();
    expect(await held(medium.storageKey)).toBe(404);
    const gone = await mediumOf(first.fileId);
    expect(gone.erasedAt).not.toBeNull();
    expect(gone.sha256).toBe(medium.sha256);
    expect(await eventsOf(medium.id)).toEqual(['content_media_expiring', 'content_media_erased']);

    // Given again: the same medium holds its original again, for a year from today.
    const again = await dropOne('nora', photo);
    await sendWhole(again);
    await receive();
    expect(await rows(again.dropId)).toEqual({ drop: 'ready', files: [{ state: 'kept', refusal: null }] });
    const back = await mediumOf(again.fileId);
    expect(back.id).toBe(medium.id);
    expect(back.erasedAt).toBeNull();
    expect((back.expiresAt?.getTime() ?? 0) - Date.now()).toBeGreaterThan((DROP_KEPT_DAYS - 1) * 86_400_000);
    expect(await held(back.storageKey)).toBe(200);
  });

  it('erases a withdrawn drop’s originals within the hour, unless another drop of hers still holds them', async () => {
    const photo = jpegOf(MB, 30, 40, 0x77);
    const first = await dropOne('nora', photo);
    await sendWhole(first);
    await receive();
    const twin = await dropOne('manager', photo);
    await sendWhole(twin, 'manager');
    await receive();
    const medium = await mediumOf(first.fileId);
    expect((await call('DELETE', `/v1/creator-space/drops/${first.dropId}`, 'nora')).statusCode).toBe(204);
    await erase();
    // The manager's drop still points at it.
    expect(await held(medium.storageKey)).toBe(200);
    expect((await call('DELETE', `/v1/creators/${nora}/drops/${twin.dropId}`, 'manager')).statusCode).toBe(
      204,
    );
    await erase();
    expect(await held(medium.storageKey)).toBe(404);
    const [erased] = await test.admin.db
      .select({ payload: schema.domainEvents.payload })
      .from(schema.domainEvents)
      .where(
        sql`${schema.domainEvents.type} = 'content_media_erased' and ${schema.domainEvents.payload}->>'mediaAssetId' = ${medium.id}`,
      );
    expect(erased?.payload).toEqual({ mediaAssetId: medium.id, reason: 'withdrawn' });
  });

  /**
   * The two orders of a race between the hourly erasure and the same photo given again (relecture Bilan de #525), each
   * step called by hand where the jobs would interleave: the storage holds the key whenever the row says held.
   */
  it('never leaves a medium held without its bytes when she gives it again while it is erased', async () => {
    const receipts = createDrizzleReceiptStore(test.admin.db);
    const retention = createDrizzleRetentionStore(test.admin.db);
    const removeRaw = (key: string) =>
      s3.fetch(`${endpoint}/${bucket}/${key}`, { method: 'DELETE' }).then(() => undefined);
    const keptAgain = async (fileId: string, medium: Awaited<ReturnType<typeof mediumOf>>) => {
      await receipts.settle(fileId, { state: 'received' }, new Date(), 'test');
      // As a receipt that found the medium held and skipped writing its bytes.
      await receipts.settle(
        fileId,
        {
          state: 'kept',
          media: {
            kind: 'image',
            mime: 'image/jpeg',
            bytes: medium.bytes,
            sha256: medium.sha256,
            storageKey: medium.storageKey,
            durationMs: null,
            uploaded: false,
          },
        },
        new Date(),
        'test',
      );
    };
    const withdrawnOnce = async (seed: number) => {
      const first = await dropOne('nora', jpegOf(MB, 30, 40, seed));
      await sendWhole(first);
      await receive();
      expect((await call('DELETE', `/v1/creator-space/drops/${first.dropId}`, 'nora')).statusCode).toBe(204);
      return { first, medium: await mediumOf(first.fileId) };
    };

    // 1. Erased between the receipt's look and its settling: the settling refuses, the retry writes the bytes again.
    const one = await withdrawnOnce(0x91);
    const again = await dropOne('nora', jpegOf(MB, 30, 40, 0x91));
    await sendWhole(again);
    const [due] = (await retention.dueOriginals(new Date())).filter((o) => o.mediaAssetId === one.medium.id);
    if (due === undefined) throw new Error('not due');
    expect(await retention.erase(due, new Date(), 'test', removeRaw)).toBe(true);
    await expect(keptAgain(again.fileId, one.medium)).rejects.toThrow('erased meanwhile');
    expect((await rows(again.dropId)).files).toEqual([{ state: 'received', refusal: null }]);
    await receive();
    expect((await rows(again.dropId)).files).toEqual([{ state: 'kept', refusal: null }]);
    expect((await mediumOf(again.fileId)).erasedAt).toBeNull();
    expect(await held(one.medium.storageKey)).toBe(200);

    // 2. Given again between the erasure's read and its removal: checked again under the lock, it stays.
    const two = await withdrawnOnce(0x92);
    const [stale] = (await retention.dueOriginals(new Date())).filter(
      (o) => o.mediaAssetId === two.medium.id,
    );
    if (stale === undefined) throw new Error('not due');
    const redrop = await dropOne('nora', jpegOf(MB, 30, 40, 0x92));
    await sendWhole(redrop);
    await keptAgain(redrop.fileId, two.medium);
    expect(await retention.erase(stale, new Date(), 'test', removeRaw)).toBe(false);
    expect(await held(two.medium.storageKey)).toBe(200);
    expect((await mediumOf(two.first.fileId)).erasedAt).toBeNull();
  });

  it('refuses a send left unfinished for 24 hours, and its drop is blocked with her sentence', async () => {
    // Begun 25 hours ago: written as the admin role, a drop's date never moves once written (0108's trigger).
    const dropId = newId(ContentDropIdSchema);
    const [her] = await test.admin.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, 'nora@example.test'));
    await test.admin.db.insert(schema.contentDrops).values({
      id: dropId,
      creatorId: nora,
      category: 'feed_shoot',
      createdBy: her?.id ?? '',
      createdAt: new Date(Date.now() - 25 * 3_600_000),
    });
    await test.admin.db.insert(schema.contentDropFiles).values({
      id: newId(ContentDropFileIdSchema),
      creatorId: nora,
      dropId,
      position: 0,
      kind: 'image',
      mime: 'image/jpeg',
      bytes: MB,
    });
    const fresh = await dropOne('nora', jpegOf(MB, 30, 40, 0x88));
    await erase();
    expect(await rows(dropId)).toEqual({
      drop: 'blocked',
      files: [
        { state: 'refused', refusal: 'L’envoi ne s’est pas terminé dans les 24 h : dépose-le à nouveau' },
      ],
    });
    // Begun just now, it waits.
    expect(await rows(fresh.dropId)).toEqual({
      drop: 'uploading',
      files: [{ state: 'awaiting', refusal: null }],
    });
  });
});
