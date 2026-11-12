import {
  calendarDayAt,
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
} from '@impera/contracts';
import { and, eq, schema, sql, withTenantMember } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import {
  chatterStatsOf,
  dailyStatsOf,
  revealSalesFeed,
  type ChatterStatsDay,
  type DailyStatsDay,
} from '../modules/connectors';
import { addDays } from '../modules/connectors/domain/daily-stats';
import { buildServer, type Server } from '../server';

import { createFakeCrm, FAKE_CRM_BASE_URL, FAKE_CRM_KEY, type FakeCrm } from './fake-reveal/crm';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };

/**
 * The daily photo of Reveal's statistics (ADR 0081), by account and by chatter (ADR 0092 § 1), through the real app:
 * the hourly job against FakeReveal, the calls counted and the reserve kept, and who reads the photos. Everything is
 * invented (ADR 0010).
 */
describe('daily statistics of the platform (ADR 0081)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let crm: FakeCrm;
  let owner: string;
  let ownerId: string;
  let jobLogger: ReturnType<typeof createLogger>;
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);
  const noraAccount = newId(PlatformAccountIdSchema);
  const today = calendarDayAt(new Date(), 'Europe/Paris');
  const users: Record<'manager' | 'outsideManager' | 'chatter' | 'creator', string> = {
    manager: 'user_manager',
    outsideManager: 'user_manager_outside',
    chatter: 'user_chatter',
    creator: 'user_creator',
  };

  const run = () => app.modules.connectors.jobs.readDailyStats(jobLogger, 'job:test');
  const statsCalls = () => crm.calls.filter((call) => call.path === '/v1/stats/daily').length;
  const chatterCalls = () => crm.calls.filter((call) => call.path === '/v1/stats/chatters/daily').length;
  const counted = async () =>
    (
      await test.admin.db
        .select({ calls: schema.salesFeedStatsCalls.calls })
        .from(schema.salesFeedStatsCalls)
        .where(
          and(eq(schema.salesFeedStatsCalls.platform, 'reveal'), eq(schema.salesFeedStatsCalls.day, today)),
        )
    )[0]?.calls ?? 0;
  const photo = () =>
    test.admin.db.select().from(schema.platformDailyStats).orderBy(schema.platformDailyStats.day);
  const chatterPhoto = () =>
    test.admin.db
      .select()
      .from(schema.platformChatterDailyStats)
      .orderBy(schema.platformChatterDailyStats.day, schema.platformChatterDailyStats.platformChatterId);
  const at = (day: string) => `${day}T10:00:00.000Z`;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    crm = createFakeCrm();
    crm.statsFromRegister();
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 9).toString('base64')}`,
    });
    jobLogger = createLogger(config, new LogSink());
    app = await createApp(config, jobLogger, {
      salesFeeds: { reveal: revealSalesFeed(crm.fetch, FAKE_CRM_BASE_URL) },
    });
    server = await buildServer({ config, logger: jobLogger, routes: app.routes, readiness: app.readiness });
    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, OWNER));
    owner = await signIn(server, OWNER.email, OWNER.password);
    await test.admin.db.insert(schema.creators).values([
      { id: nora, nameKey: 'nora', displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: ines, nameKey: 'ines', displayName: 'Ines', timezone: 'Europe/Paris' },
    ]);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: noraAccount, creatorId: nora, platform: 'reveal', handle: 'creatrice_test' });
    // Only the first model is linked: the second one's days are never kept (§ 3).
    await test.admin.db.insert(schema.salesFeedModels).values({
      platform: 'reveal',
      platformModelId: 'model_test_01',
      platformAccountId: noraAccount,
      creatorId: nora,
    });
    const accounts: [string, 'operator' | 'creator', string[], 'manager' | 'chatter' | null][] = [
      [users.manager, 'operator', [nora], 'manager'],
      [users.outsideManager, 'operator', [ines], 'manager'],
      [users.chatter, 'operator', [nora], 'chatter'],
      [users.creator, 'creator', [nora], null],
    ];
    for (const [id, role, creatorIds, teamRole] of accounts) {
      await test.admin.db
        .insert(schema.user)
        .values({ id, name: id, email: `${id}@example.test`, role, creatorIds });
      if (teamRole !== null)
        await test.admin.db.insert(schema.teamMembers).values({
          id: newId(TeamMemberIdSchema),
          userId: id,
          teamRole,
          firstName: 'Prénom',
          lastName: 'Inventé',
          displayName: id,
          country: 'FR',
          timeZone: 'Europe/Paris',
          joinedOn: '2026-10-01',
        });
    }
    crm.sell({ id: 'sale_stats_01', createdAt: at(today) });
    crm.sell({ id: 'sale_stats_02', createdAt: at(addDays(today, -10)) });
    crm.sell({ id: 'sale_stats_03', createdAt: at(addDays(today, -40)) });
    crm.sell({ id: 'sale_stats_04', modelId: 'model_test_02', createdAt: at(today) });
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

  it('reads the 31 last days the first time, the linked models alone, counters only', async () => {
    const before = statsCalls();
    await run();
    expect(statsCalls()).toBe(before + 1);
    // The days by chatter are one more call, counted with the first (ADR 0092 § 1).
    expect(chatterCalls()).toBe(1);
    expect(await counted()).toBe(2);
    const rows = await photo();
    expect(rows.map((row) => row.day)).toEqual([addDays(today, -10), today]);
    expect(rows[1]).toMatchObject({
      platform: 'reveal',
      platformAccountId: noraAccount,
      creatorId: nora,
      ppvPurchased: 1,
      activeSubscribers: 40,
      unsubscribes: 0,
      renewals: 0,
    });
    // The messages are null until the platform's night: kept null, never 0.
    expect(rows[1]?.messagesSent).toBeNull();
    const [cursor] = await test.admin.db
      .select({ at: schema.salesFeedCursors.statsFullReadAt })
      .from(schema.salesFeedCursors)
      .where(eq(schema.salesFeedCursors.platform, 'reveal'));
    expect(cursor?.at).toBeInstanceOf(Date);
  });

  it('keeps the same days by chatter: the linked models alone, PPV and messages, never an amount (ADR 0092 § 1)', async () => {
    const rows = await chatterPhoto();
    expect(rows.map((row) => [row.day, row.platformChatterId])).toEqual([
      [addDays(today, -10), 'chatter_test_01'],
      [today, 'chatter_test_01'],
    ]);
    expect(rows[1]).toMatchObject({
      platform: 'reveal',
      platformAccountId: noraAccount,
      creatorId: nora,
      ppvPurchased: 1,
    });
    expect(rows[1]?.ppvSent).toEqual(expect.any(Number));
    expect(rows[1]?.messagesSent).toEqual(expect.any(Number));
    expect(Object.keys(rows[1] ?? {}).filter((key) => /revenue|amount|minor|fan/iu.test(key))).toEqual([]);
  });

  it('reads today and yesterday after that, each day written over', async () => {
    crm.sell({ id: 'sale_stats_05', createdAt: at(today) });
    crm.sell({ id: 'sale_stats_06', createdAt: at(addDays(today, -10)) });
    await run();
    expect(await counted()).toBe(4);
    const rows = await photo();
    expect(rows.map((row) => [row.day, row.ppvPurchased])).toEqual([
      [addDays(today, -10), 1],
      [today, 2],
    ]);
    expect((await chatterPhoto()).map((row) => [row.day, row.ppvPurchased])).toEqual([
      [addDays(today, -10), 1],
      [today, 2],
    ]);
  });

  it('counts the calls of the reliability check too', async () => {
    const checked = await server.inject({
      method: 'POST',
      url: '/v1/settings/sales-feeds/reveal/check',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: { from: addDays(today, -2), to: addDays(today, -1), export: null },
    });
    expect(checked.statusCode).toBe(200);
    expect(await counted()).toBe(6);
  });

  it('calls no more once fewer than 100 of the day’s 500 calls are left', async () => {
    // One call left before the reserve: the days by account are read, those by chatter wait for the next day.
    await test.admin.db
      .update(schema.salesFeedStatsCalls)
      .set({ calls: 399 })
      .where(
        and(eq(schema.salesFeedStatsCalls.platform, 'reveal'), eq(schema.salesFeedStatsCalls.day, today)),
      );
    const [daily, byChatter] = [statsCalls(), chatterCalls()];
    await run();
    expect([statsCalls(), chatterCalls()]).toEqual([daily + 1, byChatter]);
    expect(await counted()).toBe(400);
    await test.admin.db
      .update(schema.salesFeedStatsCalls)
      .set({ calls: 400 })
      .where(
        and(eq(schema.salesFeedStatsCalls.platform, 'reveal'), eq(schema.salesFeedStatsCalls.day, today)),
      );
    const before = statsCalls();
    await run();
    expect(statsCalls()).toBe(before);
    expect(await counted()).toBe(400);
  });

  it('shows the photo to the owner and to a manager whose list has her, nobody else', async () => {
    const range = { from: addDays(today, -30), to: today };
    const read = (userId: string): Promise<DailyStatsDay[]> =>
      withTenantMember(app.db.db, nora, userId, (tx) => dailyStatsOf(tx, range));
    expect(await read(ownerId)).toHaveLength(2);
    expect(await read(users.manager)).toHaveLength(2);
    expect(await read(users.outsideManager)).toEqual([]);
    expect(await read(users.chatter)).toEqual([]);
    expect(await read(users.creator)).toEqual([]);
  });

  it('shows the days by chatter to the owner and to a manager whose list has her, never to a chatter', async () => {
    const range = { from: addDays(today, -30), to: today };
    const read = (userId: string): Promise<ChatterStatsDay[]> =>
      withTenantMember(app.db.db, nora, userId, (tx) => chatterStatsOf(tx, range));
    expect((await read(ownerId)).map((row) => row.platformChatterId)).toEqual([
      'chatter_test_01',
      'chatter_test_01',
    ]);
    expect(await read(users.manager)).toHaveLength(2);
    expect(await read(users.outsideManager)).toEqual([]);
    // A chatter reads none, his own days included (ADR 0043 § 7).
    expect(await read(users.chatter)).toEqual([]);
    expect(await read(users.creator)).toEqual([]);
  });

  it('lets the app write neither table, even as the owner', async () => {
    await expect(
      withTenantMember(app.db.db, nora, ownerId, (tx) =>
        tx.execute(sql`update platform_daily_stats set ppv_purchased = 9`),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantMember(app.db.db, nora, ownerId, (tx) =>
        tx.execute(sql`update platform_chatter_daily_stats set ppv_purchased = 9`),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantMember(app.db.db, nora, ownerId, (tx) =>
        tx.execute(sql`select * from sales_feed_stats_calls`),
      ),
    ).rejects.toThrow();
  });

  it('leaves an archived creator out of the reading', async () => {
    await test.admin.db.delete(schema.salesFeedStatsCalls);
    await test.admin.db.delete(schema.platformDailyStats);
    await test.admin.db.delete(schema.platformChatterDailyStats);
    await test.admin.db
      .update(schema.creators)
      .set({ archivedAt: new Date() })
      .where(eq(schema.creators.id, nora));
    await run();
    expect(await photo()).toEqual([]);
    expect(await chatterPhoto()).toEqual([]);
  });
});
