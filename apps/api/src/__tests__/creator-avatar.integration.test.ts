import {
  CreatorIdSchema,
  CreatorListSchema,
  JOB_PAYLOADS,
  SalesFeedImportResultSchema,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { revealSalesFeed, type AvatarPorts } from '../modules/connectors';
import { buildServer, type Server } from '../server';

import {
  createFakeCrm,
  FAKE_CRM_BASE_URL,
  FAKE_CRM_KEY,
  type FakeCrm,
  type FakeModel,
} from './fake-reveal/crm';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple horse' };

/** A 1×1 PNG, invented: what FakeReveal's image server answers for her photo. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);
const PHOTO_URL = 'https://cdn.example.test/avatars/photo.png';
const PAGE_URL = 'https://cdn.example.test/avatars/page.html';

/** Invented models (ADR 0010): one with a photo, one whose « photo » is a page, one without. */
const WITH_PHOTO: FakeModel = {
  modelId: 'model_avatar_photo',
  userName: 'photo_test',
  displayName: 'Photo Test',
  isActive: true,
  status: 'validated',
  avatarUrl: PHOTO_URL,
};
const WITH_PAGE: FakeModel = {
  modelId: 'model_avatar_page',
  userName: 'page_test',
  displayName: 'Page Test',
  isActive: true,
  status: 'validated',
  avatarUrl: PAGE_URL,
};
const WITHOUT: FakeModel = {
  modelId: 'model_avatar_none',
  userName: 'sansphoto_test',
  displayName: 'Sans Photo Test',
  isActive: true,
  status: 'validated',
};

const JobSchema = z.array(z.object({ payload: z.unknown() }));

/** Her photo copied at her import and served by the API (CRM-07 a2b, ADR 0069 § 3), against FakeReveal. */
describe('creator photo (CRM-07 a2b)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let crm: FakeCrm;
  let owner: string;
  let jobLogger: ReturnType<typeof createLogger>;
  const stored = new Map<string, Uint8Array>();
  const fetched: string[] = [];

  const avatars: Pick<AvatarPorts, 'fetch' | 'store'> = {
    fetch: (url) => {
      fetched.push(url);
      if (url === PHOTO_URL) return Promise.resolve({ ok: true, bytes: new Uint8Array(PNG) });
      if (url === PAGE_URL)
        return Promise.resolve({ ok: true, bytes: new TextEncoder().encode('<html></html>') });
      return Promise.resolve({ ok: false, reason: 'not_found' });
    },
    store: {
      put: (key, jpeg) => {
        stored.set(key, jpeg);
        return Promise.resolve();
      },
      get: (key) => Promise.resolve(stored.get(key) ?? null),
    },
  };

  const avatarUrl = (creatorId: string) => `/v1/creators/${creatorId}/avatar`;
  const get = (url: string, cookie = owner) =>
    server.inject({ method: 'GET', url, headers: { cookie, origin: DASHBOARD_ORIGIN } });

  /** The copy jobs the import enqueued, run as the worker would. */
  async function runCopies() {
    const result = await test.admin.db.execute(
      sql`select payload from graphile_worker._private_jobs
           join graphile_worker._private_tasks t on t.id = task_id
          where t.identifier = 'connector.copy_avatar'`,
    );
    const jobs = JobSchema.parse(result.rows).map((row) =>
      JOB_PAYLOADS['connector.copy_avatar'].parse(row.payload),
    );
    for (const payload of jobs) await app.modules.connectors.jobs.copyAvatar(payload, jobLogger);
    return jobs;
  }

  async function importAll() {
    const answer = await server.inject({
      method: 'POST',
      url: '/v1/settings/sales-feeds/reveal/import',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: {
        lines: [WITH_PHOTO, WITH_PAGE, WITHOUT].map((model) => ({
          platformModelId: model.modelId,
          action: { kind: 'create' },
        })),
      },
    });
    expect(answer.statusCode).toBe(200);
    const { lines } = SalesFeedImportResultSchema.parse(answer.json());
    const idOf = (modelId: string) => {
      const line = lines.find((candidate) => candidate.platformModelId === modelId);
      if (line?.outcome !== 'created') throw new Error(`${modelId} not created`);
      return line.creatorId;
    };
    return { photo: idOf(WITH_PHOTO.modelId), page: idOf(WITH_PAGE.modelId), none: idOf(WITHOUT.modelId) };
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    crm = createFakeCrm();
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 9).toString('base64')}`,
    });
    jobLogger = createLogger(config, new LogSink());
    app = await createApp(config, jobLogger, {
      salesFeeds: { reveal: revealSalesFeed(crm.fetch, FAKE_CRM_BASE_URL) },
      creatorAvatars: avatars,
    });
    server = await buildServer({ config, logger: jobLogger, routes: app.routes, readiness: app.readiness });
    await createOwner(app.auth, app.db.db, OWNER);
    owner = await signIn(server, OWNER.email, OWNER.password);
    const connected = await server.inject({
      method: 'PUT',
      url: '/v1/settings/sales-feeds/reveal/key',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: { key: FAKE_CRM_KEY },
    });
    expect(connected.statusCode).toBe(200);
    crm.setModels([WITH_PHOTO, WITH_PAGE, WITHOUT]);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await crm.app.close();
    await test.close();
  });

  it('copies her photo after her import, re-encoded, and serves it from our origin', async () => {
    const ids = await importAll();
    // One job per creator with a photo: none for the one without; the queue carries ids, never the address.
    const jobs = await runCopies();
    expect(jobs.map((job) => job.creatorId).sort()).toEqual([ids.photo, ids.page].sort());
    expect(JSON.stringify(jobs)).not.toContain('cdn.example.test');
    expect(fetched.sort()).toEqual([PAGE_URL, PHOTO_URL]);

    // Stored as a JPEG under her key, never the platform's bytes as they came.
    const key = `creators/${ids.photo}/avatar`;
    const jpeg = stored.get(key);
    expect(jpeg?.subarray(0, 3)).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    const [row] = await test.admin.db
      .select({ avatarKey: schema.creators.avatarKey })
      .from(schema.creators)
      .where(eq(schema.creators.id, ids.photo));
    expect(row?.avatarKey).toBe(key);

    const served = await get(avatarUrl(ids.photo));
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

    // A page is not a photo, and a creator without one has her initials.
    expect(stored.has(`creators/${ids.page}/avatar`)).toBe(false);
    const missing = await get(avatarUrl(ids.page));
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'creator_avatar_not_found' } });
    expect((await get(avatarUrl(ids.none))).statusCode).toBe(404);

    const list = CreatorListSchema.parse((await get('/v1/creators')).json());
    const hasAvatar = new Map(list.creators.map((creator) => [creator.id, creator.hasAvatar]));
    expect(hasAvatar.get(ids.photo)).toBe(true);
    expect(hasAvatar.get(ids.page)).toBe(false);
    expect(hasAvatar.get(ids.none)).toBe(false);

    // Replayed, the job writes the same key over.
    await runCopies();
    expect([...stored.keys()]).toEqual([key]);
  });

  it('shows her photo to her, to an operator of hers, and to nobody else', async () => {
    const [row] = await test.admin.db
      .select({ id: schema.creators.id })
      .from(schema.creators)
      .where(eq(schema.creators.displayName, WITH_PHOTO.displayName));
    const creatorId = CreatorIdSchema.parse(row?.id);
    const other = CreatorIdSchema.parse(
      (
        await test.admin.db
          .select({ id: schema.creators.id })
          .from(schema.creators)
          .where(eq(schema.creators.displayName, WITHOUT.displayName))
      )[0]?.id,
    );

    expect((await server.inject({ method: 'GET', url: avatarUrl(creatorId) })).statusCode).toBe(401);

    const { userId: operatorId } = await createOwner(app.auth, app.db.db, OPERATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [other] })
      .where(eq(schema.user.id, operatorId));
    const operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    expect((await get(avatarUrl(creatorId), operator)).statusCode).toBe(403);
    await test.admin.db
      .update(schema.user)
      .set({ creatorIds: [creatorId] })
      .where(eq(schema.user.id, operatorId));
    expect((await get(avatarUrl(creatorId), operator)).statusCode).toBe(200);

    const { userId: creatorUserId } = await createOwner(app.auth, app.db.db, CREATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [other] })
      .where(eq(schema.user.id, creatorUserId));
    const creator = await signIn(server, CREATOR.email, CREATOR.password);
    expect((await get(avatarUrl(creatorId), creator)).statusCode).toBe(404);
    await test.admin.db
      .update(schema.user)
      .set({ creatorIds: [creatorId] })
      .where(eq(schema.user.id, creatorUserId));
    expect((await get(avatarUrl(creatorId), creator)).statusCode).toBe(200);
  });
});
