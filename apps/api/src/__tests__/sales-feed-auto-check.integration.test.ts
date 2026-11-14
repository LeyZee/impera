import {
  AccountPayRulesIdSchema,
  CreatorIdSchema,
  EVENT_PAYLOADS,
  newId,
  PlatformAccountIdSchema,
  type PayPeriod,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { revealSalesFeed } from '../modules/connectors';
import { fortnightBefore } from '../modules/connectors/domain/auto-check';
import { buildServer, type Server } from '../server';

import { createFakeCrm, FAKE_CRM_BASE_URL, FAKE_CRM_KEY, type FakeCrm } from './fake-reveal/crm';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const HOUR = 3_600_000;

/**
 * The automatic check of the sales feed (CRM-04 b3) through the real app: the fortnight just over, the register's net
 * against Reveal's statistics for an account paid on that net, a second look a day later, one event at most.
 * Everything is invented (ADR 0010).
 */
describe('sales feed automatic check (CRM-04 b3)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let crm: FakeCrm;
  let jobLogger: ReturnType<typeof createLogger>;
  let account: string;
  // The fortnight the crontab's run checks today, in Reveal's zone.
  const { from } = fortnightBefore(new Date(), 'Europe/Paris');
  const saleAt = (hour: number) => `${from}T${String(hour).padStart(2, '0')}:00:00.000Z`;

  const read = () => app.modules.connectors.jobs.readSales(jobLogger, 'test', true);
  const run = (recheck?: { platform: 'reveal'; from: PayPeriod }) =>
    app.modules.connectors.jobs.checkSales(recheck === undefined ? {} : { recheck }, jobLogger, 'job:test');
  const rechecks = async () =>
    (
      await test.admin.db.execute<{ run_at: Date; payload: unknown }>(
        sql`select run_at, payload from graphile_worker._private_jobs where key = ${`connector.check_sales:reveal:${from}`}`,
      )
    ).rows;
  const mismatches = () =>
    test.admin.db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.type, 'sales_feed_mismatch'));

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    crm = createFakeCrm();
    crm.statsFromRegister();
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_SERVICE_URL: test.serviceUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 9).toString('base64')}`,
    });
    const logger = createLogger(config, new LogSink());
    jobLogger = logger;
    app = await createApp(config, logger, {
      salesFeeds: { reveal: revealSalesFeed(crm.fetch, FAKE_CRM_BASE_URL) },
    });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    const { userId } = await createOwner(app.auth, app.db.db, OWNER);
    const owner = await signIn(server, OWNER.email, OWNER.password);
    const creator = newId(CreatorIdSchema);
    account = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.creators).values({
      id: creator,
      nameKey: 'creatrice_test',
      displayName: 'Créatrice test',
      timezone: 'Europe/Paris',
    });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: account, creatorId: creator, platform: 'reveal', handle: 'creatrice_test' });
    // Paid on Reveal's net since January, written in December: every fortnight since is checked.
    await test.admin.db.insert(schema.accountPayRules).values({
      id: newId(AccountPayRulesIdSchema),
      creatorId: creator,
      platformAccountId: account,
      fromPeriod: '2026-01-01',
      currency: 'EUR',
      vatBps: 0,
      platformFeeBps: 0,
      earningsSource: 'detected',
      createdBy: userId,
      createdAt: new Date('2025-12-20T12:00:00Z'),
    });
    const connected = await server.inject({
      method: 'PUT',
      url: '/v1/settings/sales-feeds/reveal/key',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: { key: FAKE_CRM_KEY },
    });
    expect(connected.statusCode).toBe(200);
    crm.sell({ id: 'sale_auto_01', createdAt: saleAt(10) });
    await read();
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await crm.app.close();
    await test.close();
  });

  it('does nothing when the nets agree: no second look, no event, no report kept', async () => {
    await run();
    expect(await rechecks()).toEqual([]);
    expect(await mismatches()).toEqual([]);
    expect(await test.admin.db.select().from(schema.salesFeedChecks)).toEqual([]);
  });

  it('looks again a day later at a mismatch, once however often the run is replayed', async () => {
    // Reveal has it, the register has not read it yet.
    crm.sell({ id: 'sale_auto_02', createdAt: saleAt(11) });
    const before = Date.now();
    await run();
    await run();
    const jobs = await rechecks();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toEqual({ recheck: { platform: 'reveal', from } });
    expect(new Date(jobs[0]?.run_at ?? 0).getTime()).toBeGreaterThanOrEqual(before + 23 * HOUR);
    expect(await mismatches()).toEqual([]);
  });

  it('publishes nothing when the second look finds the nets agreeing again', async () => {
    await read();
    await run({ platform: 'reveal', from });
    expect(await mismatches()).toEqual([]);
  });

  it('publishes the mismatch once, with no creator, no fan and no chatter, and never a report', async () => {
    crm.sell({ id: 'sale_auto_03', createdAt: saleAt(12) });
    await run({ platform: 'reveal', from });
    await run({ platform: 'reveal', from });
    const events = await mismatches();
    expect(events).toHaveLength(1);
    expect(events[0]?.creatorId).toBeNull();
    expect(EVENT_PAYLOADS.sales_feed_mismatch.parse(events[0]?.payload)).toEqual({
      platform: 'reveal',
      from,
      to: fortnightBefore(new Date(), 'Europe/Paris').to,
      days: [
        {
          day: from,
          platformAccountId: account,
          currency: 'EUR',
          registerNetMinor: 1600,
          platformNetMinor: 2400,
          differenceMinor: 800,
        },
      ],
    });
    expect(JSON.stringify(events[0]?.payload)).not.toMatch(/chatter|fan/iu);
    expect(await test.admin.db.select().from(schema.salesFeedChecks)).toEqual([]);
  });

  it('is tried again, never an agreement, when the platform does not give its statistics', async () => {
    crm.withhold('stats');
    const before = (await mismatches()).length;
    await expect(run()).rejects.toThrow(/refused by reveal/u);
    expect(await mismatches()).toHaveLength(before);
  });
});
