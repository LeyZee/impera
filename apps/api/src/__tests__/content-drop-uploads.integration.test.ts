import { randomBytes } from 'node:crypto';

import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ContentDropSchema,
  CreatorIdSchema,
  DROP_PART_BYTES,
  DropFileUploadSchema,
  newId,
  TeamMemberIdSchema,
  type CreatorId,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { AwsClient } from 'aws4fetch';
import { runOnce } from 'graphile-worker';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/**
 * Her files sent straight to the media storage (CR-06 b, ADR 0055 § 3), against a real object store: MinIO in a
 * container, or the server named by `IMPERA_TEST_S3_URL` where Docker is not available (its user in
 * `IMPERA_TEST_S3_USER` and `IMPERA_TEST_S3_PASSWORD`). Each part goes up to the address the API signed, the send
 * resumes after a cut, and the receipt job marks the file and its drop received. Invented data only (ADR 0010).
 */
const IMAGE = 'coollabsio/minio:RELEASE.2025-10-15T17-29-55Z';
const USER = process.env['IMPERA_TEST_S3_USER'] ?? 'impera-test';
const PASSWORD = process.env['IMPERA_TEST_S3_PASSWORD'] ?? 'impera-test-password';
const REGION = 'us-east-1';
const ACCOUNT_PASSWORD = 'correct horse battery';
const PARIS = 'Europe/Paris';
const MB = 1024 * 1024;

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
    app = await createApp(config, createLogger(config));
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
      const member = await account(`${teamRole}@example.test`, { role: 'operator' });
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

  /** A drop of one photo of `bytes`, by her or by the manager for her; its file and the file's bytes. */
  async function dropOne(who: 'nora' | 'manager', bytes: number) {
    const file = { id: newId(ContentDropFileIdSchema), mime: 'image/jpeg', bytes };
    const drop = { id: newId(ContentDropIdSchema), category: 'feed_shoot', files: [file] };
    const url = who === 'nora' ? '/v1/creator-space/drops' : `/v1/creators/${nora}/drops`;
    const response = await call('POST', url, who, drop);
    expect(response.statusCode, response.body).toBe(200);
    const base =
      who === 'nora'
        ? `/v1/creator-space/drops/${drop.id}/files/${file.id}`
        : `/v1/creators/${nora}/drops/${drop.id}/files/${file.id}`;
    return { dropId: drop.id, fileId: file.id, bytes: randomBytes(bytes), base };
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

  it('sends her photo in parts, resumes after a cut, and the job receives it with its drop', async () => {
    const { dropId, base, bytes } = await dropOne('nora', 9 * MB);
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
    expect(await rows(dropId)).toEqual({ drop: 'received', files: [{ state: 'received', refusal: null }] });
    // Once per drop, for the trend watch (VEI-01 d): the request that asked for it, none here.
    const events = await test.admin.db
      .select({ creatorId: schema.domainEvents.creatorId, payload: schema.domainEvents.payload })
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.type, 'content_drop_received'));
    expect(events).toEqual([{ creatorId: nora, payload: { dropId, requestId: null } }]);
    // Replayed once received, « complete » answers the drop as it is.
    const replay = await call('POST', `${base}/complete`, 'nora', { parts });
    expect(replay.statusCode).toBe(200);
    expect(ContentDropSchema.parse(replay.json())).toMatchObject({ state: 'received' });
    expect((await upload(base, 'nora')).sent).toBe(true);
  });

  it('signs each address for its part’s exact size: a part cut otherwise is refused by the storage', async (context) => {
    // A store that does not check presigned signatures (moto, for the runs without Docker) cannot say it.
    if (process.env['IMPERA_TEST_S3_CHECKS_SIGNATURES'] === 'false') context.skip();
    const { base, bytes } = await dropOne('nora', 9 * MB);
    const plan = await upload(base, 'nora');
    const shorter = await put(plan.missing[0]?.url ?? '', bytes.subarray(0, MB));
    expect(shorter.status).toBe(403);
    const tampered = new URL(plan.missing[1]?.url ?? '');
    tampered.searchParams.set('partNumber', '3');
    expect((await put(tampered.toString(), sliceOf(bytes, 2))).status).toBe(403);
  });

  it('refuses « complete » without every part, and a file whose stored size is not the one declared', async () => {
    const { dropId, fileId, base, bytes } = await dropOne('nora', 9 * MB);
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
    const mine = await dropOne('nora', MB);
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
    const theirs = await dropOne('manager', MB);
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
    expect((await rows(theirs.dropId)).drop).toBe('received');
  });

  it('takes no more bytes once her drop is withdrawn, and the job erases what had arrived', async () => {
    const { dropId, fileId, base, bytes } = await dropOne('nora', MB);
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
});
