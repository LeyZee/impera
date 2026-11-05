import { CreatorIdSchema, newId, PlatformAccountIdSchema, SalesFeedNewModelsSchema } from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { revealSalesFeed } from '../modules/connectors';
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
const NEW_MODELS_URL = '/v1/settings/sales-feeds/new-models';
const CountSchema = z.array(z.object({ n: z.number() }));

/** Invented models (ADR 0010): `model_watch_linked` is linked at connection by its handle, the other is not. */
const LINKED: FakeModel = {
  modelId: 'model_watch_linked',
  userName: 'reliee_test',
  displayName: 'Reliée Test',
  isActive: true,
  status: 'validated',
};
const UNLINKED: FakeModel = {
  modelId: 'model_watch_new',
  userName: 'nouvelle_test',
  displayName: 'Nouvelle Test',
  isActive: true,
  status: 'pending',
};

/** The watch of Reveal's model list by the sales reading (CRM-07 a2, ADR 0069 § 5), against FakeReveal. */
describe('sales feed model watch (CRM-07 a2)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let crm: FakeCrm;
  let owner: string;
  let now = new Date('2026-11-05T10:00:00.000Z');
  let jobLogger: ReturnType<typeof createLogger>;

  /** A reading a quarter of an hour after the one before: the list is looked at again. */
  async function readLater() {
    now = new Date(now.getTime() + 16 * 60 * 1000);
    await app.modules.connectors.jobs.readSales(jobLogger, 'test', true);
  }

  async function count(query: ReturnType<typeof sql>): Promise<number> {
    const result = await test.admin.db.execute(query);
    return CountSchema.parse(result.rows)[0]?.n ?? 0;
  }

  const signals = (kind: string) =>
    count(
      sql`select count(*)::int as n from domain_events where type = 'sales_feed_signal' and payload->'signal'->>'kind' = ${kind}`,
    );

  async function newModels(cookie = owner) {
    const answer = await server.inject({
      method: 'GET',
      url: NEW_MODELS_URL,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
    });
    return answer;
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    crm = createFakeCrm();
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 9).toString('base64')}`,
    });
    const logger = createLogger(config, new LogSink());
    jobLogger = logger;
    app = await createApp(config, logger, {
      salesFeeds: { reveal: revealSalesFeed(crm.fetch, FAKE_CRM_BASE_URL) },
      connectorsClock: () => now,
    });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    await createOwner(app.auth, app.db.db, OWNER);
    const { userId } = await createOwner(app.auth, app.db.db, OPERATOR);
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    const creator = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creator, nameKey: 'reliee test', displayName: 'Reliée Test', timezone: 'Europe/Paris' });
    await test.admin.db.insert(schema.platformAccounts).values({
      id: newId(PlatformAccountIdSchema),
      creatorId: creator,
      platform: 'reveal',
      handle: 'reliee_test',
    });
    crm.setModels([LINKED, UNLINKED]);
    const connected = await server.inject({
      method: 'PUT',
      url: '/v1/settings/sales-feeds/reveal/key',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: { key: FAKE_CRM_KEY },
    });
    expect(connected.statusCode).toBe(200);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await crm.app.close();
    await test.close();
  });

  it('counts, for the badge, the models listed with no link and not set aside', async () => {
    expect(SalesFeedNewModelsSchema.parse((await newModels()).json())).toEqual({ total: 0, byPlatform: [] });
    await readLater();
    const sighted = await test.admin.db
      .select({ id: schema.salesFeedModelSightings.platformModelId })
      .from(schema.salesFeedModelSightings)
      .orderBy(schema.salesFeedModelSightings.platformModelId);
    expect(sighted.map((row) => row.id)).toEqual(['model_watch_linked', 'model_watch_new']);
    expect(SalesFeedNewModelsSchema.parse((await newModels()).json())).toEqual({
      total: 1,
      byPlatform: [{ platform: 'reveal', count: 1 }],
    });

    const aside = await server.inject({
      method: 'PUT',
      url: '/v1/settings/sales-feeds/reveal/models/model_watch_new/dismissal',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
    });
    expect(aside.statusCode).toBeLessThan(300);
    expect(SalesFeedNewModelsSchema.parse((await newModels()).json())).toEqual({ total: 0, byPlatform: [] });
  });

  it('says once that a linked model left the list, again only after she came back', async () => {
    crm.setModels([UNLINKED]);
    await readLater();
    await readLater();
    expect(await signals('model_gone')).toBe(1);

    // An empty list says nothing of who left.
    crm.setModels([]);
    await readLater();
    expect(await signals('model_gone')).toBe(1);

    crm.setModels([LINKED, UNLINKED]);
    await readLater();
    crm.setModels([UNLINKED]);
    await readLater();
    expect(await signals('model_gone')).toBe(2);
    crm.setModels([LINKED, UNLINKED]);
    await readLater();
  });

  it('says once that a linked model is banned, and a status it does not know once', async () => {
    crm.setModels([
      { ...LINKED, status: 'banned', isActive: false },
      { ...UNLINKED, status: 'banned' },
    ]);
    await readLater();
    await readLater();
    // The unlinked one is nobody's yet: nothing to say.
    expect(await signals('model_banned')).toBe(1);

    crm.setModels([LINKED, { ...UNLINKED, status: 'suspendedForReview' }]);
    await readLater();
    await readLater();
    expect(
      await count(
        sql`select count(*)::int as n from domain_events where type = 'sales_feed_signal'
              and payload->'signal'->>'kind' = 'unknown_value' and payload->'signal'->>'value' = 'suspendedForReview'`,
      ),
    ).toBe(1);
    const [row] = await test.admin.db
      .select({
        status: schema.salesFeedModelSightings.status,
        banned: schema.salesFeedModelSightings.bannedSignalledAt,
      })
      .from(schema.salesFeedModelSightings)
      .where(eq(schema.salesFeedModelSightings.platformModelId, 'model_watch_linked'));
    expect(row).toEqual({ status: 'validated', banned: null });
  });

  it('is the owner’s only', async () => {
    expect((await server.inject({ method: 'GET', url: NEW_MODELS_URL })).statusCode).toBe(401);
    const operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    expect((await newModels(operator)).statusCode).toBe(403);
  });
});
