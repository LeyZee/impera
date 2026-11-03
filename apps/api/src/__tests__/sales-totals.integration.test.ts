import {
  CreatorIdSchema,
  CreatorSalesSchema,
  EVENT_PAYLOADS,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type PlatformAccountId,
  type SalesTotals,
  type TeamMemberId,
  UserIdSchema,
} from '@nirvana/contracts';
import { eq, schema, sql, withCreatorAccount, withTenant } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { creatorSalesReads, revealSalesFeed, salesFeedTotals } from '../modules/connectors';
import { buildServer, type Server } from '../server';

import { createFakeCrm, FAKE_CRM_BASE_URL, FAKE_CRM_KEY, type FakeCrm } from './fake-reveal/crm';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const CHATTER = { email: 'chatter@example.test', name: 'Chatteur', password: 'staple battery horse' };
const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };

const RungSchema = z.object({ platform_sale_id: z.string(), creator_id: z.string(), payload: z.unknown() });
const StatsSchema = z.object({
  data: z.array(
    z.object({
      date: z.string(),
      modelId: z.string(),
      revenueTtc: z.number(),
      revenueHt: z.number(),
      agencyRevenue: z.number(),
      modelRevenue: z.number(),
    }),
  ),
});

/**
 * CRM-04 lot a through the real app: a sale read in Reveal's register rings once, fresh, with its seller and never its
 * fan; the totals the Dashboard and the evening digest read give Reveal's daily statistics back, to the cent.
 * Everything is invented (ADR 0010).
 */
describe('sales rung and totals (CRM-04 lot a)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let crm: FakeCrm;
  let owner: string;
  let creatorId: CreatorId;
  let accountId: PlatformAccountId;
  let otherCreatorId: CreatorId;
  let otherAccountId: PlatformAccountId;
  let memberId: TeamMemberId;
  let jobLogger: ReturnType<typeof createLogger>;

  const read = () => app.modules.connectors.jobs.readSales(jobLogger, 'test', true);

  /** Every `sale_detected`, with the register's key of its line. */
  async function rung() {
    const result = await test.admin.db.execute(sql`
      select l.platform_sale_id, e.creator_id, e.payload
        from domain_events e
        join platform_sales l on l.id = (e.payload->>'saleId')::uuid
       where e.type = 'sale_detected'
       order by l.platform_sale_id`);
    return z
      .array(RungSchema)
      .parse(result.rows)
      .map((row) => ({ ...row, payload: EVENT_PAYLOADS.sale_detected.parse(row.payload) }));
  }

  const api = (method: 'PUT', url: string, payload: object) =>
    server.inject({ method, url, headers: { cookie: owner, origin: DASHBOARD_ORIGIN }, payload });

  async function creatorWithAccount(handle: string): Promise<[CreatorId, PlatformAccountId]> {
    const creator = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creator, nameKey: handle, displayName: handle, timezone: 'Europe/Paris' });
    const account = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: account, creatorId: creator, platform: 'reveal', handle });
    return [creator, account];
  }

  /** Reveal's statistics of the days for the creator's model, by day. */
  async function revealStats(from: string, to: string) {
    const answer = await crm.fetch(`${FAKE_CRM_BASE_URL}/v1/stats/daily?from=${from}&to=${to}`, {
      headers: { 'x-api-key': FAKE_CRM_KEY },
      signal: new AbortController().signal,
    });
    const stats = StatsSchema.parse(JSON.parse(await answer.text()));
    return new Map(
      stats.data
        .filter((row) => row.modelId === 'model_test_01')
        .map((row) => [
          row.date,
          {
            grossInclVat: row.revenueTtc,
            grossExclVat: row.revenueHt,
            agency: row.agencyRevenue,
            creator: row.modelRevenue,
          },
        ]),
    );
  }

  /** The totals summed by day over every account, kind and seller, as Reveal's statistics are. */
  function byDay(totals: { readonly rows: readonly Omit<SalesTotals['rows'][number], 'seller'>[] }) {
    const days = new Map<
      string,
      { grossInclVat: number; grossExclVat: number; agency: number; creator: number }
    >();
    for (const row of totals.rows) {
      const day = days.get(row.day) ?? { grossInclVat: 0, grossExclVat: 0, agency: 0, creator: 0 };
      days.set(row.day, {
        grossInclVat: day.grossInclVat + row.grossInclVatMinor,
        grossExclVat: day.grossExclVat + row.grossExclVatMinor,
        agency: day.agency + row.agencyMinor,
        creator: day.creator + row.creatorMinor,
      });
    }
    return days;
  }

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
    const { userId } = await createOwner(app.auth, app.db.db, CHATTER);
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    memberId = newId(TeamMemberIdSchema);
    await test.admin.db.insert(schema.teamMembers).values({
      id: memberId,
      userId,
      teamRole: 'chatter',
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: 'Chatteur',
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    await test.admin.db.insert(schema.salesFeedChatters).values([
      { platform: 'reveal', platformChatterId: 'chatter_test_01', kind: 'member', memberId },
      { platform: 'reveal', platformChatterId: 'bot_test_01', kind: 'agent' },
    ]);
    // The handle of FakeReveal's first model: linked on its own at connection. The second one waits in quarantine.
    [creatorId, accountId] = await creatorWithAccount('creatrice_test');
    [otherCreatorId, otherAccountId] = await creatorWithAccount('compte_sans_lien');
    const connected = await api('PUT', '/v1/settings/sales-feeds/reveal/key', { key: FAKE_CRM_KEY });
    expect(connected.statusCode).toBe(200);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await crm.app.close();
    await test.close();
  });

  it('rings a fresh sale once, with its seller and never its fan; a replay, a late sale, a refund and the quarantine ring nothing', async () => {
    const fresh = new Date(Date.now() - 60_000).toISOString();
    crm.sell({ id: 'sale_member', createdAt: fresh });
    crm.sell({ id: 'sale_agent', createdAt: fresh, chatterId: 'bot_test_01', type: 'tip' });
    crm.sell({ id: 'sale_nobody', createdAt: fresh, chatterId: null });
    crm.sell({ id: 'sale_unlinked', createdAt: fresh, chatterId: 'chatter_test_02' });
    // Read late: a webhook missed, the cursor catching up. It counts, and rings nothing.
    crm.sell({ id: 'sale_late', createdAt: '2026-10-20T18:00:00.000Z' });
    crm.sell({ id: 'sale_quarantine', modelId: 'model_test_02', createdAt: fresh });
    await read();

    const first = await rung();
    expect(first.map((one) => [one.platform_sale_id, one.payload.seller])).toEqual([
      ['sale_agent', { kind: 'agent' }],
      ['sale_member', { kind: 'member', memberId }],
      ['sale_nobody', { kind: 'none' }],
      ['sale_unlinked', { kind: 'unlinked' }],
    ]);
    expect(first[1]).toMatchObject({
      creator_id: creatorId,
      payload: {
        platform: 'reveal',
        platformAccountId: accountId,
        saleType: 'ppv',
        occurredAt: fresh,
        currency: 'EUR',
        grossInclVatMinor: 1200,
        netMinor: 800,
        agencyMinor: 300,
        creatorMinor: 500,
      },
    });
    expect(first[0]?.payload.saleType).toBe('tip');
    // Never the fan: neither his id nor his pseudo.
    for (const one of first) {
      expect(JSON.stringify(one.payload)).not.toMatch(/member_test_01|fan_test_01/);
    }

    // The register read again from its start, a refund: nothing rings again.
    crm.refund('sale_member', new Date().toISOString());
    await test.admin.db
      .update(schema.salesFeedCursors)
      .set({ position: null })
      .where(eq(schema.salesFeedCursors.platform, 'reveal'));
    await read();
    expect(await rung()).toEqual(first);

    // The quarantined sale joins the register when its model is linked: late, it rings nothing.
    const linked = await api('PUT', '/v1/settings/sales-feeds/reveal/models/model_test_02', {
      platformAccountId: otherAccountId,
    });
    expect(linked.statusCode).toBe(200);
    const released = await test.admin.db
      .select({ creatorId: schema.platformSales.creatorId })
      .from(schema.platformSales)
      .where(eq(schema.platformSales.platformSaleId, 'sale_quarantine'));
    expect(released).toEqual([{ creatorId: otherCreatorId }]);
    expect(await rung()).toEqual(first);
  });

  it('gives a month of totals equal to Reveal’s statistics to the cent, a refund taken off its sale’s day', async () => {
    // 23:30 UTC on 30/09 is the 1st of October in Paris; 22:30 UTC on 31/10 is the 1st of November.
    crm.sell({ id: 'sale_oct_first', createdAt: '2026-09-30T23:30:00.000Z' });
    crm.sell({ id: 'sale_nov_first', createdAt: '2026-10-31T23:30:00.000Z' });
    crm.sell({
      id: 'sale_oct_tip',
      createdAt: '2026-10-12T14:00:00.000Z',
      type: 'tip',
      amountTtc: 600,
      amountHt: 500,
      agencyRevenue: 150,
      modelRevenue: 250,
    });
    crm.sell({
      id: 'sale_oct_bot',
      createdAt: '2026-10-12T15:00:00.000Z',
      chatterId: 'bot_test_01',
      amountTtc: 2400,
      amountHt: 2000,
      agencyRevenue: 600,
      modelRevenue: 1000,
    });
    crm.sell({ id: 'sale_oct_refunded', createdAt: '2026-10-25T09:00:00.000Z' });
    // Refunded in November: taken off the 25th of October, as Reveal does.
    crm.refund('sale_oct_refunded', '2026-11-02T10:00:00.000Z');
    await read();

    const totals = await withTenant(app.db.db, creatorId, (tx) =>
      salesFeedTotals.totalsOf(tx, { creatorId, ...OCTOBER }),
    );
    expect(totals.refundsWithoutSale).toBe(0);
    expect(byDay(totals)).toEqual(await revealStats(OCTOBER.from, OCTOBER.to));
    expect(totals.rows.find((row) => row.day === '2026-10-25')).toMatchObject({
      sales: 1,
      refunds: 1,
      grossInclVatMinor: 0,
      creatorMinor: 0,
    });
    // A row per seller and kind: the agent's sale stays apart from the member's tip.
    expect(
      totals.rows
        .filter((row) => row.day === '2026-10-12')
        .map((row) => [row.saleType, row.seller.kind, row.grossInclVatMinor]),
    ).toEqual([
      ['ppv', 'agent', 2400],
      ['tip', 'member', 600],
    ]);

    // The evening digest's job reads as the admin role: the same figures. Another creator's tenant reads none of them.
    const asAdmin = await test.admin.db.transaction((tx) =>
      salesFeedTotals.totalsOf(tx, { creatorId, ...OCTOBER }),
    );
    expect(asAdmin).toEqual(totals);
    const elsewhere = await withTenant(app.db.db, otherCreatorId, (tx) =>
      salesFeedTotals.totalsOf(tx, { creatorId, ...OCTOBER }),
    );
    expect(elsewhere.rows).toEqual([]);
  });

  it('says a day’s refunds on their own day, an older sale’s included, and how far each register was read', async () => {
    // `sale_oct_refunded` was refunded on the 2nd of November: in no totals of that day, here on its own.
    const refunds = await withTenant(app.db.db, creatorId, (tx) =>
      salesFeedTotals.refundsOf(tx, { creatorId, day: '2026-11-02' }),
    );
    expect(refunds.day).toBe('2026-11-02');
    expect(refunds.rows).toHaveLength(1);
    expect(refunds.rows[0]).toMatchObject({
      platform: 'reveal',
      platformAccountId: accountId,
      currency: 'EUR',
      saleType: 'ppv',
      sale: 'earlier_day',
      refunds: 1,
      grossInclVatMinor: 1200,
    });
    expect(JSON.stringify(refunds)).not.toMatch(/fan_test_01/);
    // Another creator's tenant reads none of them.
    const elsewhere = await withTenant(app.db.db, otherCreatorId, (tx) =>
      salesFeedTotals.refundsOf(tx, { creatorId, day: '2026-11-02' }),
    );
    expect(elsewhere.rows).toEqual([]);

    const readings = await withTenant(app.db.db, creatorId, (tx) =>
      salesFeedTotals.readingsOf(tx, creatorId),
    );
    expect(readings.map(({ platform, pausedUntil }) => ({ platform, pausedUntil }))).toEqual([
      { platform: 'reveal', pausedUntil: null },
    ]);
    // Read by the runs above: the last read that went through, not a day without a sale.
    expect(readings[0]?.readAt).not.toBeNull();
    const [unlinked] = await creatorWithAccount('sans_lien_test');
    expect(await withTenant(app.db.db, unlinked, (tx) => salesFeedTotals.readingsOf(tx, unlinked))).toEqual(
      [],
    );
  });

  it('gives the creator, through her own account, Reveal’s figures to the cent, with no seller and her fan by his card', async () => {
    const creatorUser = newId(UserIdSchema);
    await test.admin.db.insert(schema.user).values({
      id: creatorUser,
      name: 'Créatrice test',
      email: 'creatrice@example.test',
      role: 'creator',
      creatorIds: [creatorId],
    });
    // The fan of FakeReveal's sales has a card in her creator: his id comes with her lines, never the platform's.
    const fanId = newId(FanIdSchema);
    await withTenant(app.db.db, creatorId, (tx) =>
      tx.insert(schema.fans).values({
        id: fanId,
        creatorId,
        platformAccountId: accountId,
        platformFanId: 'member_test_01',
        displayName: 'Fan test',
      }),
    );

    const mine = await withCreatorAccount(app.db.db, creatorUser, (tx) =>
      creatorSalesReads.salesOf(tx, OCTOBER),
    );
    // The strict contract of her screen: a field of who sold, or of the platform's fan, would fail it.
    expect(CreatorSalesSchema.parse(mine)).toEqual(mine);
    expect(byDay(mine)).toEqual(await revealStats(OCTOBER.from, OCTOBER.to));
    const totals = await withTenant(app.db.db, creatorId, (tx) =>
      salesFeedTotals.totalsOf(tx, { creatorId, ...OCTOBER }),
    );
    const part = (rows: readonly { creatorMinor: number }[]) =>
      rows.reduce((sum, row) => sum + row.creatorMinor, 0);
    expect(part(mine.rows)).toBe(part(totals.rows));
    // The refund of November sits on its sale's day, the 25th of October, beside its sale.
    expect(
      mine.lines
        .filter((line) => line.saleDay === '2026-10-25')
        .map((line) => [line.event, line.creatorMinor]),
    ).toEqual([
      ['sale', 500],
      ['refund', 500],
    ]);
    expect(new Set(mine.lines.map((line) => line.fanId))).toEqual(new Set([fanId]));
    expect(JSON.stringify(mine)).not.toMatch(/member_test_01|fan_test_01|chatter_test_01|bot_test_01/);

    // Any other door reads nothing from her view: the agency in her creator, and the job's admin role.
    const asAgency = await withTenant(app.db.db, creatorId, (tx) => creatorSalesReads.salesOf(tx, OCTOBER));
    expect(asAgency.rows).toEqual([]);
    const asAdmin = await test.admin.db.transaction((tx) => creatorSalesReads.salesOf(tx, OCTOBER));
    expect(asAdmin.lines).toEqual([]);
  });
});
