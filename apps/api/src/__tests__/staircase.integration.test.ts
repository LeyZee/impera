import {
  ConversationIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  MessageIdSchema,
  newId,
  PlatformAccountIdSchema,
  type CreatorId,
  type FanId,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { createDrizzleUnitOfWork } from '../modules/conversations/infra/db/unit-of-work';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';

/**
 * The staircase of her scripts' paid steps (ADR 0098, avenant du 27/11/2026): the agency's settings, entered by the
 * owner alone and empty until then, and what the agent reads of a fan for it (his biggest paid message). Everything is
 * invented (ADR 0010), the settings too.
 */
describe('PUT /v1/creators/:id/staircase and the fan’s biggest purchase', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let creatorId: CreatorId;
  let fanId: FanId;
  const cookies = new Map<'owner' | 'manager', string>();

  const call = (method: 'GET' | 'PUT', who: 'owner' | 'manager', payload?: object) =>
    server.inject({
      method,
      url: `/v1/creators/${creatorId}/staircase`,
      headers: { origin: DASHBOARD_ORIGIN, cookie: cookies.get(who) },
      ...(payload !== undefined && { payload }),
    });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    creatorId = newId(CreatorIdSchema);
    const accountId = newId(PlatformAccountIdSchema);
    const conversationId = newId(ConversationIdSchema);
    fanId = newId(FanIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: 'nora', displayName: 'Nora', timezone: 'Europe/Paris' });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: accountId, creatorId, platform: 'reveal', handle: 'creatrice_test' });
    await test.admin.db.insert(schema.fans).values({
      id: fanId,
      creatorId,
      platformAccountId: accountId,
      platformFanId: 'fan_a',
      displayName: 'Arnaud',
    });
    await test.admin.db.insert(schema.conversations).values({
      id: conversationId,
      creatorId,
      platformAccountId: accountId,
      fanId,
      platformConversationId: 'conv_a',
    });
    // Two paid messages he bought and one he did not: only the bought ones count, the biggest of them.
    const message = (ref: string, priceMinor: number, isPaid: boolean) => ({
      id: newId(MessageIdSchema),
      creatorId,
      platformAccountId: accountId,
      conversationId,
      platformMessageId: ref,
      direction: 'outbound',
      author: 'ai',
      priceMinor,
      currency: 'EUR',
      isPaid,
      platformCreatedAt: new Date(),
    });
    await test.admin.db
      .insert(schema.messages)
      .values([message('m1', 1_300, true), message('m2', 2_100, true), message('m3', 9_900, false)]);
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.set('owner', await signIn(server, 'owner@example.test', PASSWORD));
    const { userId } = await createOwner(app.auth, app.db.db, {
      email: 'manager@example.test',
      name: 'manager',
      password: PASSWORD,
    });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [creatorId] })
      .where(eq(schema.user.id, userId));
    cookies.set('manager', await signIn(server, 'manager@example.test', PASSWORD));
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  const fanStats = () =>
    createDrizzleUnitOfWork(test.app.db).inTenant(creatorId, (tx) => tx.messages.fanStats(fanId, new Date()));

  it('reads nothing set at first, and his biggest bought message', async () => {
    const read = await call('GET', 'owner');
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({});
    const stats = await fanStats();
    expect(stats.biggestPurchaseMinor).toBe(2_100);
    expect(stats.staircase).toEqual({});
  });

  it('lets the owner alone set it, refuses a multiple not above one, and the agent reads it', async () => {
    const setting = { targetMultiple: 1.7, startCapMultiple: 1.25, spendBranchJumpMultiple: 2.4 };
    expect((await call('PUT', 'manager', setting)).statusCode).toBe(403);
    expect((await call('PUT', 'owner', { startCapMultiple: 1 })).statusCode).toBe(400);
    const saved = await call('PUT', 'owner', setting);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual(setting);
    expect((await call('GET', 'owner')).json()).toEqual(setting);
    expect((await fanStats()).staircase).toEqual(setting);
  });
});
