import {
  CreatorAgencyRateIdSchema,
  CreatorIdSchema,
  EVENT_PAYLOADS,
  newId,
  PlatformAccountIdSchema,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
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

/**
 * The agency percentages' check (CRM-04 lot d3) through the real app: the register read from FakeReveal, the
 * fortnight just over, her part as Reveal gives it against the percentage set for her, one event at most. Everything
 * is invented (ADR 0010): the creator, the sales and the percentages, never the agency's own.
 */
describe('agency percentages against her part on the register (CRM-04 d3)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let crm: FakeCrm;
  let jobLogger: ReturnType<typeof createLogger>;
  let creator: string;
  let account: string;
  let ownerId: string;
  // The fortnight the crontab's run checks today, in the agency's zone (Europe/Paris, as Reveal's here).
  const { from, to } = fortnightBefore(new Date(), 'Europe/Paris');
  const saleAt = (hour: number) => `${from}T${String(hour).padStart(2, '0')}:00:00.000Z`;

  const run = () => app.modules.scheduling.jobs.checkAgencyShares('job:test');
  const mismatches = () =>
    test.admin.db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.type, 'agency_share_mismatch'));
  const setRate = (fromDay: string, agencyBps: number) =>
    test.admin.db.insert(schema.creatorAgencyRates).values({
      id: newId(CreatorAgencyRateIdSchema),
      creatorId: creator,
      fromDay,
      agencyBps,
      createdBy: ownerId,
    });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    crm = createFakeCrm();
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
    ownerId = (await createOwner(app.auth, app.db.db, OWNER)).userId;
    const owner = await signIn(server, OWNER.email, OWNER.password);
    creator = newId(CreatorIdSchema);
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
    const connected = await server.inject({
      method: 'PUT',
      url: '/v1/settings/sales-feeds/reveal/key',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: { key: FAKE_CRM_KEY },
    });
    expect(connected.statusCode).toBe(200);
    // Two sales of the fortnight, 3,00 € for the agency and 5,00 € for her each: 37,5 % of an 8,00 € net.
    crm.sell({ id: 'sale_share_01', createdAt: saleAt(10) });
    crm.sell({ id: 'sale_share_02', createdAt: saleAt(11) });
    await app.modules.connectors.jobs.readSales(jobLogger, 'test', true);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await crm.app.close();
    await test.close();
  });

  it('compares nothing while she has no percentage', async () => {
    expect(await run()).toBe(0);
    expect(await mismatches()).toEqual([]);
  });

  it('publishes nothing when her part is the net less the percentage', async () => {
    await setRate('2026-01-01', 3750);
    expect(await run()).toBe(0);
    expect(await mismatches()).toEqual([]);
  });

  it('publishes a gap once, with her part read and the one the percentage gives, never a fan nor a chatter', async () => {
    // From the fortnight's first day, 35 %: her part would be 5,20 € a sale where Reveal gives 5,00 €.
    await setRate(from, 3500);
    expect(await run()).toBe(1);
    expect(await run()).toBe(0);
    const events = await mismatches();
    expect(events).toHaveLength(1);
    expect(events[0]?.creatorId).toBe(creator);
    expect(EVENT_PAYLOADS.agency_share_mismatch.parse(events[0]?.payload)).toEqual({
      creatorId: creator,
      platform: 'reveal',
      platformAccountId: account,
      from,
      to,
      currency: 'EUR',
      sales: 2,
      refunds: 0,
      creatorMinor: 1000,
      expectedCreatorMinor: 1040,
      differenceMinor: -40,
    });
    expect(JSON.stringify(events[0]?.payload)).not.toMatch(/chatter|fan|seller|member/iu);
  });

  it('changes no amount: the register and her percentages are as they were', async () => {
    const lines = await test.admin.db.select().from(schema.platformSales);
    const rates = await test.admin.db.select().from(schema.creatorAgencyRates);
    await run();
    expect(await test.admin.db.select().from(schema.platformSales)).toEqual(lines);
    expect(await test.admin.db.select().from(schema.creatorAgencyRates)).toEqual(rates);
  });
});
