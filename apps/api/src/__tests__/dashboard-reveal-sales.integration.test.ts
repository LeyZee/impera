import {
  CreatorIdSchema,
  DashboardSchema,
  newId,
  PlatformAccountIdSchema,
  SalesLineIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type PlatformAccountId,
  type TeamMemberId,
} from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';

/**
 * CRM-04 lot c through the real app: the Dashboard's sales panel reads the register's totals as they are, by seller
 * for the owner and an active manager only, never for a chatter nor for the creator. Everything is invented
 * (ADR 0010).
 */
describe('GET /v1/dashboard, the sales read in the register (CRM-04 lot c)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let creatorId: CreatorId;
  let accountId: PlatformAccountId;
  let unlinkedCreatorId: CreatorId;
  let theo: TeamMemberId;
  type Who = 'owner' | 'manager' | 'chatter' | 'operator' | 'creator';
  const cookies = new Map<Who, string>();

  const get = (who: Who, creator: CreatorId, period = 'day') =>
    server.inject({
      method: 'GET',
      url: `/v1/dashboard?creatorId=${creator}&period=${period}`,
      headers: { origin: DASHBOARD_ORIGIN, cookie: cookies.get(who) },
    });
  const dashboard = async (who: Who, creator: CreatorId, period = 'day') => {
    const answer = await get(who, creator, period);
    expect(answer.statusCode, answer.body).toBe(200);
    return DashboardSchema.parse(answer.json());
  };

  async function person(
    key: Exclude<Who, 'owner'>,
    role: 'operator' | 'creator',
    creators: readonly CreatorId[],
  ): Promise<string> {
    const email = `${key}@example.test`;
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: key, password: PASSWORD });
    await test.admin.db
      .update(schema.user)
      .set({ role, creatorIds: [...creators] })
      .where(eq(schema.user.id, userId));
    cookies.set(key, await signIn(server, email, PASSWORD));
    return userId;
  }

  async function member(userId: string, teamRole: 'manager' | 'chatter', displayName: string) {
    const id = newId(TeamMemberIdSchema);
    await test.admin.db.insert(schema.teamMembers).values({
      id,
      userId,
      teamRole,
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName,
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    return id;
  }

  let position = 0;
  /** A line of the register, a sale or its refund, at `at`. */
  async function line(
    saleId: string,
    chatter: string | null,
    at: Date,
    patch: { event?: 'sale' | 'refund'; currency?: 'EUR' | 'USD'; gross?: number } = {},
  ) {
    position += 1;
    const gross = patch.gross ?? 1200;
    await test.admin.db.insert(schema.platformSales).values({
      id: newId(SalesLineIdSchema),
      creatorId,
      platformAccountId: accountId,
      platform: 'reveal',
      platformSaleId: saleId,
      event: patch.event ?? 'sale',
      saleType: 'ppv',
      status: patch.event === 'refund' ? 'refunded' : 'paid',
      occurredAt: at,
      platformModelId: 'model_test_01',
      platformChatterId: chatter,
      platformFanId: 'fan_test_01',
      currency: patch.currency ?? 'EUR',
      grossInclVatMinor: gross,
      grossExclVatMinor: Math.round((gross * 5) / 6),
      netMinor: Math.round((gross * 2) / 3),
      agencyMinor: Math.round(gross / 4),
      creatorMinor: Math.round((gross * 2) / 3) - Math.round(gross / 4),
      position: String(position).padStart(6, '0'),
      inputsHash: `hash-${saleId}-${patch.event ?? 'sale'}`,
    });
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });

    creatorId = newId(CreatorIdSchema);
    unlinkedCreatorId = newId(CreatorIdSchema);
    accountId = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.creators).values([
      { id: creatorId, nameKey: 'nora', displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: unlinkedCreatorId, nameKey: 'sans-lien', displayName: 'Sans lien', timezone: 'Europe/Paris' },
    ]);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: accountId, creatorId, platform: 'reveal', handle: 'creatrice_test' });
    await test.admin.db.insert(schema.salesFeedModels).values({
      platform: 'reveal',
      platformModelId: 'model_test_01',
      platformAccountId: accountId,
      creatorId,
    });

    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.set('owner', await signIn(server, 'owner@example.test', PASSWORD));
    await member(await person('manager', 'operator', [creatorId, unlinkedCreatorId]), 'manager', 'Maya');
    theo = await member(await person('chatter', 'operator', [creatorId]), 'chatter', 'Théo');
    // An operator of the dashboard with no record in the team: his scope is his own, he reads none of the panel.
    await person('operator', 'operator', [creatorId]);
    await person('creator', 'creator', [creatorId]);
    await test.admin.db.insert(schema.salesFeedChatters).values([
      { platform: 'reveal', platformChatterId: 'chatter_theo', kind: 'member', memberId: theo },
      { platform: 'reveal', platformChatterId: 'bot_test_01', kind: 'agent' },
    ]);

    // Today in Paris, whatever the hour the test runs at: a minute ago, never before her midnight.
    const now = new Date(Date.now() - 60_000);
    await line('sale_theo', 'chatter_theo', now);
    await line('sale_theo_2', 'chatter_theo', now, { gross: 600 });
    await line('sale_theo_2', 'chatter_theo', now, { event: 'refund', gross: 600 });
    await line('sale_agent', 'bot_test_01', now, { gross: 3000 });
    await line('sale_unlinked', 'chatter_inconnu', now);
    await line('sale_nobody', null, now, { gross: 600 });
    // Ten days ago: in the month, not in the day.
    await line('sale_old', 'chatter_theo', new Date(Date.now() - 10 * 86_400_000), { gross: 2400 });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives the owner the period’s figures and who sold, in four kinds, the register’s amounts as they are', async () => {
    const { revealSales } = await dashboard('owner', creatorId);
    expect(revealSales).not.toBeNull();
    expect(revealSales?.platforms).toEqual(['reveal']);
    expect(revealSales?.totals).toEqual({
      sales: 5,
      refunds: 1,
      revenueMinor: 1200 + 600 - 600 + 3000 + 1200 + 600,
      netMinor: 800 + 400 - 400 + 2000 + 800 + 400,
      agencyMinor: 300 + 150 - 150 + 750 + 300 + 150,
      creatorMinor: 500 + 250 - 250 + 1250 + 500 + 250,
    });
    expect(
      revealSales?.bySeller?.map((one) => [one.seller, one.sales, one.refunds, one.revenueMinor]),
    ).toEqual([
      [{ kind: 'agent' }, 1, 0, 3000],
      [{ kind: 'member', memberId: theo, name: 'Théo' }, 2, 1, 1200],
      [{ kind: 'unlinked' }, 1, 0, 1200],
      [{ kind: 'none' }, 1, 0, 600],
    ]);
    // Never the fan: neither his id at the platform nor anything of his.
    expect(JSON.stringify(revealSales)).not.toMatch(/fan_test_01/u);

    const month = await dashboard('owner', creatorId, 'month');
    expect(month.revealSales?.totals.revenueMinor).toBe(6000 + 2400);
  });

  it('gives an active manager who sold, and nothing to a reader whose scope is his own (ADR 0043 § 7)', async () => {
    const manager = await dashboard('manager', creatorId);
    expect(manager.revealSales?.bySeller?.map((one) => one.seller.kind)).toEqual([
      'agent',
      'member',
      'unlinked',
      'none',
    ]);
    // Not even the totals: taking his own sales off them would give him the others'.
    expect((await dashboard('operator', creatorId)).revealSales).toBeNull();
    // A chatter of the team reads the conversations routed to him, never the Dashboard (ADR 0024).
    expect((await get('chatter', creatorId)).statusCode).toBe(403);
  });

  it('shows the creator nothing of it: the Dashboard is closed to her (ADR 0042 § 2 and § 8)', async () => {
    expect((await get('creator', creatorId)).statusCode).toBe(403);
  });

  it('stays away while none of her accounts is linked to the register', async () => {
    expect((await dashboard('owner', unlinkedCreatorId)).revealSales).toBeNull();
    expect((await dashboard('manager', unlinkedCreatorId)).revealSales).toBeNull();
  });

  it('changes nothing of pay: no statement, no line of pay written by a read', async () => {
    const statements = async () =>
      (await test.admin.db.execute(sql`select count(*)::int as n from commission_statements`)).rows;
    const before = await statements();
    await dashboard('owner', creatorId, 'month');
    await dashboard('manager', creatorId, 'week');
    expect(await statements()).toEqual(before);
  });
});
