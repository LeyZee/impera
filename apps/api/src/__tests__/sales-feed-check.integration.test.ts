import {
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  SalesFeedCheckReportSchema,
} from '@nirvana/contracts';
import { eq, schema } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { revealSalesFeed } from '../modules/connectors';
import { buildServer, type Server } from '../server';

import { createFakeCrm, FAKE_CRM_BASE_URL, FAKE_CRM_KEY, type FakeCrm } from './fake-reveal/crm';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const CHECK_URL = '/v1/settings/sales-feeds/reveal/check';

/**
 * The dashboard's export as the owner would download it, invented (ADR 0010): French separators and decimals, a fan
 * column the check never reads, a row of another model, one before the days checked.
 */
const EXPORT = [
  'Date;Modèle;Montant TTC;Revenu agence;Revenu modèle;Fan',
  '20/10/2026;creatrice_test;12,00 €;3,00 €;5,00 €;fan_test_01',
  '21/10/2026;creatrice_test;24,00;6,00;10,00;',
  '21/10/2026;autre_test;12,00;3,00;5,00;fan_test_02',
  '22/10/2026;model_test_01;12,00;3,00;5,00;fan_test_01',
  '19/10/2026;creatrice_test;99,00;1,00;1,00;fan_test_01',
].join('\r\n');

/** The reliability check of ADR 0050 § 8 through the real app (CRM-02): the register against Reveal's figures. */
describe('sales feed reliability check (CRM-02)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let crm: FakeCrm;
  let owner: string;
  let operator: string;
  let jobLogger: ReturnType<typeof createLogger>;

  const read = () => app.modules.connectors.jobs.readSales(jobLogger, 'test', true);
  let calls = 0;
  /** Each call from its own address: the route allows a few checks a minute an address, as Reveal's quota is small. */
  const check = (payload: object, cookie = owner) => {
    calls += 1;
    return server.inject({
      method: 'POST',
      url: CHECK_URL,
      remoteAddress: `192.0.2.${String(calls)}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload,
    });
  };
  const DAYS = { from: '2026-10-20', to: '2026-10-23' };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    crm = createFakeCrm();
    crm.statsFromRegister();
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 9).toString('base64')}`,
    });
    const logger = createLogger(config, new LogSink());
    jobLogger = logger;
    app = await createApp(config, logger, {
      salesFeeds: { reveal: revealSalesFeed(crm.fetch, FAKE_CRM_BASE_URL) },
    });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    await createOwner(app.auth, app.db.db, OWNER);
    const { userId } = await createOwner(app.auth, app.db.db, OPERATOR);
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    const creator = newId(CreatorIdSchema);
    await test.admin.db.insert(schema.creators).values({
      id: creator,
      nameKey: 'creatrice_test',
      displayName: 'Créatrice test',
      timezone: 'Europe/Paris',
    });
    await test.admin.db.insert(schema.platformAccounts).values({
      id: newId(PlatformAccountIdSchema),
      creatorId: creator,
      platform: 'reveal',
      handle: 'creatrice_test',
    });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await crm.app.close();
    await test.close();
  });

  it('needs a connected key, and is the owner’s only', async () => {
    expect((await check({ ...DAYS, export: null })).statusCode).toBe(409);
    expect((await check({ ...DAYS, export: null }, operator)).statusCode).toBe(403);
  });

  it('compares the register with the statistics per model and day, a refund taken off its sale’s day', async () => {
    const connected = await server.inject({
      method: 'PUT',
      url: '/v1/settings/sales-feeds/reveal/key',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: { key: FAKE_CRM_KEY },
    });
    expect(connected.statusCode).toBe(200);
    crm.sell({ id: 'sale_check_01', createdAt: '2026-10-20T18:00:00.000Z' });
    crm.sell({ id: 'sale_check_02', createdAt: '2026-10-20T19:00:00.000Z' });
    // 00:30 in Paris on the 22nd: Reveal's day, not the UTC one.
    crm.sell({ id: 'sale_check_03', createdAt: '2026-10-21T22:30:00.000Z' });
    crm.sell({
      id: 'sale_check_04',
      createdAt: '2026-10-21T10:00:00.000Z',
      chatterId: 'bot_test_01',
      amountTtc: 2400,
      amountHt: 2000,
      agencyRevenue: 600,
      modelRevenue: 1000,
    });
    // A model linked to no account: its line waits in quarantine and is counted in the check all the same.
    crm.sell({ id: 'sale_check_05', modelId: 'model_test_02', createdAt: '2026-10-21T12:00:00.000Z' });
    crm.refund('sale_check_01', '2026-10-23T09:00:00.000Z');
    await read();

    const answer = await check({ ...DAYS, export: null });
    expect(answer.statusCode).toBe(200);
    const report = SalesFeedCheckReportSchema.parse(answer.json());
    expect(report).toMatchObject({
      verdict: 'incomplete',
      timeZone: 'Europe/Paris',
      total: { export: null },
    });
    const net = (date: string, model: string) =>
      report.days.find((day) => day.date === date && day.platformModelId === model);
    expect(net('2026-10-20', 'model_test_01')).toMatchObject({
      handle: 'creatrice_test',
      linked: true,
      register: { grossInclVat: 1200, agency: 300, creator: 500, net: 800 },
      stats: { net: 800 },
      differs: [],
    });
    expect(net('2026-10-21', 'model_test_01')?.register.net).toBe(1600);
    expect(net('2026-10-22', 'model_test_01')?.register.net).toBe(800);
    expect(net('2026-10-21', 'model_test_02')).toMatchObject({
      linked: false,
      register: { net: 800 },
      differs: [],
    });
    expect(report.total.register.net).toBe(4000);
    expect(report.chatters).toEqual([
      {
        platformChatterId: 'bot_test_01',
        isBot: true,
        link: null,
        register: { net: 1600, sales: 1 },
        stats: { net: 1600, sales: 1 },
        differs: false,
      },
      {
        platformChatterId: 'chatter_test_01',
        isBot: false,
        link: null,
        register: { net: 2400, sales: 3 },
        stats: { net: 2400, sales: 3 },
        differs: false,
      },
    ]);
    // The bot's sales come under its own id; until it is linked to the agent, the check says so.
    expect(report.notes).toContainEqual({
      kind: 'bot_not_linked_to_agent',
      platformChatterId: 'bot_test_01',
    });
  });

  it('agrees to the cent with the dashboard’s export, whose fan column is never read', async () => {
    await server.inject({
      method: 'PUT',
      url: '/v1/settings/sales-feeds/reveal/chatters/bot_test_01',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: { kind: 'agent' },
    });
    const answer = await check({ ...DAYS, export: EXPORT });
    expect(answer.statusCode).toBe(200);
    const report = SalesFeedCheckReportSchema.parse(answer.json());
    expect(report.verdict).toBe('match');
    expect(report.total.export).toEqual({ grossInclVat: 6000, agency: 1500, creator: 2500, net: 4000 });
    expect(report.notes).toEqual([{ kind: 'export_rows_outside', count: 1 }]);
    expect(JSON.stringify(report)).not.toContain('fan_test');
  });

  it('counts a quarantined sale once after its model is linked and its line released to the register', async () => {
    const creator = newId(CreatorIdSchema);
    const account = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creator, nameKey: 'autre_test', displayName: 'Autre test', timezone: 'Europe/Paris' });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: account, creatorId: creator, platform: 'reveal', handle: 'autre_test' });
    const linked = await server.inject({
      method: 'PUT',
      url: '/v1/settings/sales-feeds/reveal/models/model_test_02',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: { platformAccountId: account },
    });
    expect(linked.statusCode).toBe(200);
    const report = SalesFeedCheckReportSchema.parse((await check({ ...DAYS, export: EXPORT })).json());
    expect(
      report.days.find((day) => day.date === '2026-10-21' && day.platformModelId === 'model_test_02'),
    ).toMatchObject({ linked: true, register: { net: 800 }, differs: [] });
    expect(report).toMatchObject({ verdict: 'match', total: { register: { net: 4000 } } });
  });

  it('says where a source differs: a sale Reveal has and the register not yet, an export that is off', async () => {
    crm.sell({ id: 'sale_check_06', createdAt: '2026-10-23T08:00:00.000Z' });
    const offExport = EXPORT.replace(
      '22/10/2026;model_test_01;12,00;3,00;5,00',
      '22/10/2026;model_test_01;12,00;3,00;5,01',
    );
    const report = SalesFeedCheckReportSchema.parse((await check({ ...DAYS, export: offExport })).json());
    expect(report.verdict).toBe('mismatch');
    const day = (date: string) =>
      report.days.find((one) => one.date === date && one.platformModelId === 'model_test_01');
    expect(day('2026-10-23')).toMatchObject({
      register: { net: 0 },
      stats: { net: 800 },
      differs: ['stats'],
    });
    expect(day('2026-10-22')?.differs).toEqual(['export']);
    expect(report.chatters.find((one) => one.platformChatterId === 'chatter_test_01')?.differs).toBe(true);

    await read();
    const again = SalesFeedCheckReportSchema.parse((await check({ ...DAYS, export: null })).json());
    expect(again.verdict).toBe('incomplete');
  });

  it('refuses an export it cannot read, naming the column, never a cell', async () => {
    const answer = await check({ ...DAYS, export: 'Date;Fan;Montant TTC\n20/10/2026;fan_test_01;12,00' });
    expect(answer.statusCode).toBe(422);
    expect(answer.json()).toMatchObject({
      error: { code: 'sales_feed_export_unprocessable', details: { column: 'modèle' } },
    });
    expect(answer.body).not.toContain('fan_test_01');
    const unreadable = await check({ ...DAYS, export: 'Date;Modèle;Net\n20/10/2026;creatrice_test;douze' });
    expect(unreadable.json()).toMatchObject({ error: { details: { column: 'net', line: 2 } } });
  });

  it('checks days that are over, a month at most, from before to', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
    const inProgress = await check({ from: '2026-10-20', to: today, export: null });
    expect(inProgress.statusCode).toBe(422);
    expect(inProgress.json()).toMatchObject({ error: { code: 'sales_feed_check_days_unprocessable' } });
    expect((await check({ from: '2026-10-01', to: '2026-11-15', export: null })).statusCode).toBe(400);
    expect((await check({ from: '2026-10-23', to: '2026-10-20', export: null })).statusCode).toBe(400);
  });
});
