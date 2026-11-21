import {
  AgencyInsightsSchema,
  AgencySteeringSchema,
  calendarDayAt,
  ConversationIdSchema,
  EventIdSchema,
  FanIdSchema,
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  SalesLineIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type PlatformAccountId,
  type TeamMemberId,
  UserIdSchema,
} from '@impera/contracts';
import { eq, schema, sql, withTenantMember } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';

/**
 * ADR 0078 through the real app: the agency's insights read in the register, for the owner and an active manager
 * only, never for a chatter, an operator of his own scope nor the creator, and never a fan. Everything is invented
 * (ADR 0010).
 */

/** This instant's midnight in Paris, in ms (the hours of a change of time are past at 3h, never in the first minute). */
function parisMidnight(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((one) => one.type === type)?.value ?? 0);
  const since = ((part('hour') * 60 + part('minute')) * 60 + part('second')) * 1000 + at.getMilliseconds();
  return at.getTime() - since;
}

const shiftDayBy = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe('GET /v1/dashboard/agency, the agency’s insights (ADR 0078)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let creatorId: CreatorId;
  let accountId: PlatformAccountId;
  let unlinkedCreatorId: CreatorId;
  let theo: TeamMemberId;
  let maya: TeamMemberId;
  type Who = 'owner' | 'manager' | 'chatter' | 'operator' | 'creator';
  const cookies = new Map<Who, string>();
  const users = new Map<Who, string>();

  const get = (who: Who, query = 'period=day') =>
    server.inject({
      method: 'GET',
      url: `/v1/dashboard/agency?${query}`,
      headers: { origin: DASHBOARD_ORIGIN, cookie: cookies.get(who) },
    });
  const agency = async (who: Who, query = 'period=day') => {
    const answer = await get(who, query);
    expect(answer.statusCode, answer.body).toBe(200);
    return AgencyInsightsSchema.parse(answer.json());
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
    users.set(key, userId);
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
    patch: { event?: 'sale' | 'refund'; currency?: 'EUR' | 'USD'; gross?: number; fan?: string } = {},
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
      platformFanId: patch.fan ?? 'fan_test_01',
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
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
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

    const owner = await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    users.set('owner', owner.userId);
    cookies.set('owner', await signIn(server, 'owner@example.test', PASSWORD));
    maya = await member(
      await person('manager', 'operator', [creatorId, unlinkedCreatorId]),
      'manager',
      'Maya',
    );
    theo = await member(await person('chatter', 'operator', [creatorId]), 'chatter', 'Théo');
    // An operator of the dashboard with no record in the team: his scope is his own, he reads none of the panel.
    await person('operator', 'operator', [creatorId]);
    await person('creator', 'creator', [creatorId]);
    await test.admin.db.insert(schema.salesFeedChatters).values([
      { platform: 'reveal', platformChatterId: 'chatter_theo', kind: 'member', memberId: theo },
      { platform: 'reveal', platformChatterId: 'bot_test_01', kind: 'agent' },
    ]);

    // Today in Paris, whatever the hour the test runs at: a minute ago, or just after midnight when it runs in the first
    // minute of the day (the route reads the real clock, up to the end of today).
    const now = new Date(Math.max(Date.now() - 60_000, parisMidnight(new Date()) + 1000));
    await line('sale_theo', 'chatter_theo', now);
    await line('sale_theo_2', 'chatter_theo', now, { gross: 600 });
    await line('sale_theo_2', 'chatter_theo', now, { event: 'refund', gross: 600 });
    await line('sale_agent', 'bot_test_01', now, { gross: 3000 });
    await line('sale_unlinked', 'chatter_inconnu', now);
    await line('sale_nobody', null, now, { gross: 600 });
    // A refund whose sale is older than the register: in no figure, counted apart.
    await line('sale_ghost', 'chatter_theo', now, { event: 'refund', gross: 900 });
    // Ten days ago: in the month, not in the day.
    await line('sale_old', 'chatter_theo', new Date(Date.now() - 10 * 86_400_000), { gross: 2400 });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives the owner the agency’s day: totals, kinds, sellers, hours and paying fans, the register’s amounts as they are', async () => {
    const result = await agency('owner');
    expect(result.creators).toEqual([{ creatorId, name: 'Nora' }]);
    expect(result.totals.current).toEqual({
      sales: 5,
      refunds: 1,
      revenueMinor: 1200 + 600 - 600 + 3000 + 1200 + 600,
      revenueExclVatMinor: 1000 + 500 - 500 + 2500 + 1000 + 500,
      netMinor: 800 + 400 - 400 + 2000 + 800 + 400,
      agencyMinor: 300 + 150 - 150 + 750 + 300 + 150,
      creatorMinor: 500 + 250 - 250 + 1250 + 500 + 250,
      // A fifth of the agency's part (ADR 0106 § 6).
      agencyTransferVatMinor: 300,
    });
    // The days carry the two parts for the tiles' small curves, adding up to the period's to the cent.
    const days = result.days.map((one) => [one.agencyMinor, one.creatorMinor]);
    expect(days.reduce((sum, [agency = 0]) => sum + agency, 0)).toBe(result.totals.current.agencyMinor);
    expect(days.reduce((sum, [, creator = 0]) => sum + creator, 0)).toBe(result.totals.current.creatorMinor);
    expect(result.kinds.map((one) => [one.kind, one.revenueMinor])).toEqual([['ppv', 6000]]);
    expect(result.sellers.map((one) => [one.seller, one.revenueMinor])).toEqual([
      [{ kind: 'agent' }, 3000],
      [{ kind: 'member', memberId: theo, name: 'Théo' }, 1200],
      [{ kind: 'unlinked' }, 1200],
      [{ kind: 'none' }, 600],
    ]);
    expect(result.byCreator.map((one) => [one.creatorId, one.revenueMinor])).toEqual([[creatorId, 6000]]);
    // The hours hold the sales alone, refunds aside: 1200 + 600 + 3000 + 1200 + 600.
    expect(result.hours.flat().reduce((sum, cell) => sum + cell, 0)).toBe(6600);
    // One fan, who bought ten days ago too: paying, not new; what he spent less the refund of his sale.
    expect(result.fans).toMatchObject({ paying: 1, newPaying: 0, averagePerPayingMinor: 6000 });
    expect(result.refundsWithoutSale).toBe(1);
    // The refunds one by one (ADR 0092 § 4): the sale's seller, the days since it, none for a sale out of the register.
    expect(
      result.refundList
        .map((one) => [one.creatorId, one.kind, one.amountMinor, one.seller, one.delayDays])
        .sort((a, b) => Number(a[2]) - Number(b[2])),
    ).toEqual([
      [creatorId, 'ppv', 600, { kind: 'member', memberId: theo, name: 'Théo' }, 0],
      [creatorId, 'ppv', 900, { kind: 'member', memberId: theo, name: 'Théo' }, null],
    ]);
    // Nothing in the photo of the statistics yet: no subscriber figure, never a zero (ADR 0081).
    expect(result.subscribers).toBeNull();
    // Never the fan: neither his id at the platform nor anything of his.
    expect(JSON.stringify(result)).not.toMatch(/fan_test_01/u);

    const month = await agency('owner', 'period=month');
    expect(month.totals.current.revenueMinor).toBe(6000 + 2400);
    expect(month.fans).toMatchObject({ paying: 1, newPaying: 1 });
    expect((await agency('owner', 'period=quarter')).days).toHaveLength(90);
  });

  it('reads the calendar’s days and the comparison chosen, and refuses one that does not end before (ADR 0146)', async () => {
    const today = calendarDayAt(new Date(), 'Europe/Paris');
    const shift = (days: number): string =>
      new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    // The sale of ten days ago alone, compared with five days long before the register.
    const custom = await agency(
      'owner',
      `unit=custom&from=${shift(-12)}&to=${shift(-8)}&compareAt=${shift(-60)}`,
    );
    expect(custom).toMatchObject({
      period: null,
      span: { unit: 'custom', partial: false, compare: 'chosen', today },
      from: shift(-12),
      to: shift(-8),
      previousFrom: shift(-60),
      previousTo: shift(-56),
    });
    expect(custom.totals.current.revenueMinor).toBe(2400);
    // Today's sales fall between the two: in neither, not even as fans of the period before.
    expect(custom.totals.previous.revenueMinor).toBe(0);
    expect(custom.fans).toMatchObject({ paying: 1, previousPaying: 0 });
    expect(custom.previousDays).toHaveLength(5);
    // The register's oldest line is the sale of ten days ago (§ 4).
    expect(custom.registerSince).toBe(shift(-10));

    const month = await agency('owner', 'unit=month');
    expect(month.span).toMatchObject({ unit: 'month', compare: 'previous', today });
    expect(month.from).toBe(`${today.slice(0, 7)}-01`);
    expect(month.to).toBe(today);

    expect((await get('owner', `unit=week&compareAt=${today}`)).statusCode).toBe(400);
    expect((await get('owner', `unit=custom&from=${shift(-2)}`)).statusCode).toBe(400);
    expect((await get('owner', 'unit=day&period=day')).statusCode).toBe(400);
  });

  it('reads one creator alone when asked, and an unlinked one as nothing to count', async () => {
    expect((await agency('owner', `period=day&creatorId=${creatorId}`)).creators).toHaveLength(1);
    const unlinked = await agency('owner', `period=day&creatorId=${unlinkedCreatorId}`);
    expect(unlinked.creators).toEqual([]);
    expect(unlinked.totals.current.revenueMinor).toBe(0);
  });

  it('gives an active manager his creators’ figures, and nothing to a reader whose scope is his own (ADR 0043 § 7)', async () => {
    const manager = await agency('manager');
    expect(manager.totals.current.revenueMinor).toBe(6000);
    // He reads the parts in the totals, so day by day too; the others read neither (403 below).
    expect(manager.days.map((one) => [one.day, one.agencyMinor, one.creatorMinor])).toEqual(
      (await agency('owner')).days.map((one) => [one.day, one.agencyMinor, one.creatorMinor]),
    );
    expect(manager.days.reduce((sum, one) => sum + one.agencyMinor, 0)).toBe(
      manager.totals.current.agencyMinor,
    );
    // Not even the totals: taking his own sales off them would give him the others'.
    expect((await get('operator')).statusCode).toBe(403);
    expect((await get('chatter')).statusCode).toBe(403);
    expect((await get('chatter', `period=day&creatorId=${creatorId}`)).statusCode).toBe(403);
  });

  it('gives a manager on leave nothing: his scope is read at each request', async () => {
    await test.admin.db
      .update(schema.teamMembers)
      .set({ status: 'on_leave' })
      .where(eq(schema.teamMembers.id, maya));
    try {
      expect((await get('manager')).statusCode).toBe(403);
    } finally {
      await test.admin.db
        .update(schema.teamMembers)
        .set({ status: 'active' })
        .where(eq(schema.teamMembers.id, maya));
    }
  });

  it('refuses a manager a creator out of his list, and the creator herself (ADR 0042 § 8)', async () => {
    const elsewhere = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: elsewhere, nameKey: 'ailleurs', displayName: 'Ailleurs', timezone: 'Europe/Paris' });
    expect((await get('manager', `period=day&creatorId=${elsewhere}`)).statusCode).toBe(403);
    expect((await get('creator')).statusCode).toBe(403);
    expect((await get('creator', `period=day&creatorId=${creatorId}`)).statusCode).toBe(403);
  });

  it('lets the owner alone set a creator’s monthly objective, read with a calendar month (ADR 0092 § 6)', async () => {
    const month = `${calendarDayAt(new Date(), 'Europe/Paris').slice(0, 7)}-01`;
    const objective = (who: Who, method: 'PUT' | 'DELETE', amountMinor = 500_000) =>
      server.inject({
        method,
        url: `/v1/dashboard/agency/objectives/${creatorId}/${month}`,
        headers: { origin: DASHBOARD_ORIGIN, cookie: cookies.get(who) },
        ...(method === 'PUT' ? { payload: { amountMinor } } : {}),
      });
    // Never a manager's to write, never her account's, never a day that is not a month's first.
    expect((await objective('manager', 'PUT')).statusCode).toBe(403);
    expect((await objective('creator', 'PUT')).statusCode).toBe(403);
    const wrongDay = await server.inject({
      method: 'PUT',
      url: `/v1/dashboard/agency/objectives/${creatorId}/${month.slice(0, 8)}02`,
      headers: { origin: DASHBOARD_ORIGIN, cookie: cookies.get('owner') },
      payload: { amountMinor: 1 },
    });
    expect(wrongDay.statusCode).toBe(400);

    expect((await objective('owner', 'PUT', 400_000)).statusCode).toBe(200);
    // Set again: replaced, never a second line.
    const set = await objective('owner', 'PUT');
    expect(set.json()).toEqual({ creatorId, month, amountMinor: 500_000 });
    const read = await agency('owner', 'unit=month');
    expect(read.objectives?.month).toBe(month);
    expect(read.objectives?.creators.find((one) => one.creatorId === creatorId)?.objectiveMinor).toBe(
      500_000,
    );
    expect(read.objectives?.objectiveMinor).toBe(500_000);
    // The manager reads it with the figures; a week reads none.
    expect((await agency('manager', 'unit=month')).objectives?.objectiveMinor).toBe(500_000);
    expect((await agency('owner', 'unit=week')).objectives).toBeNull();

    // Under the RLS, the chatter and her account read no line of it (`team_read`, `creator_closed`).
    for (const who of ['chatter', 'creator'] as const) {
      const rows = await withTenantMember(app.db.db, creatorId, users.get(who) ?? '', (tx) =>
        tx.execute(sql`select id from creator_revenue_objectives`),
      );
      expect(rows.rows, who).toHaveLength(0);
    }

    expect((await objective('owner', 'DELETE')).statusCode).toBe(204);
    expect((await agency('owner', 'unit=month')).objectives?.objectiveMinor).toBeNull();
    // Each write in the journal, amounts only: set twice, then removed.
    const journal = await test.admin.db.execute<{ action: string; details: unknown }>(sql`
      select action, details from audit_log where entity = 'creator_revenue_objective' order by created_at, action`);
    expect(journal.rows.map((row) => row.action)).toEqual([
      'objective.set',
      'objective.set',
      'objective.remove',
    ]);
    expect(journal.rows.map((row) => row.details)).toEqual([
      { creatorId, month, from: null, to: 400_000 },
      { creatorId, month, from: 400_000, to: 500_000 },
      { creatorId, month, from: 500_000 },
    ]);
  });

  it('adds the photo of the daily statistics: subscribers for the owner and a manager, never a creator (ADR 0081)', async () => {
    const today = calendarDayAt(new Date(), 'Europe/Paris');
    const shift = (days: number): string =>
      new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    // Yesterday, then today with the messages still computed by the platform.
    await test.admin.db.execute(sql`
      insert into platform_daily_stats (platform, platform_account_id, creator_id, day, new_subscribers,
        unsubscribes, active_subscribers, renewals, ppv_sent, ppv_purchased, messages_sent, messages_received, read_at)
      values ('reveal', ${accountId}::uuid, ${creatorId}::uuid, ${shift(-1)}::date, 4, 1, 120, 2, 10, 3, 40, 50, now()),
             ('reveal', ${accountId}::uuid, ${creatorId}::uuid, ${today}::date, 5, 2, 123, 1, 12, 4, null, 30, now())`);
    const week = await agency('owner', 'period=week');
    expect(week.subscribers?.current).toMatchObject({
      activeAtEnd: 123,
      newSubscribers: 9,
      unsubscribes: 3,
      renewals: 3,
      ppvSent: 22,
      ppvPurchased: 7,
      messagesSent: null,
      messagesReceived: 80,
      daysRead: 2,
      days: 7,
    });
    expect(week.subscribers?.days.at(-1)).toEqual({ day: today, active: 123 });
    // The day before yesterday is not read: the start of the day's change is unknown, never zero.
    expect((await agency('owner', 'period=day')).subscribers?.current.activeBefore).toBe(120);
    expect((await agency('manager', 'period=week')).subscribers?.current.activeAtEnd).toBe(123);
    expect((await get('creator', 'period=week')).statusCode).toBe(403);
  });

  it('gives the owner and a manager the steering: the day, traffic to money, the fans it hangs on (ADR 0092)', async () => {
    // A payer who bought thirty days ago and nothing since: named for the agency, never his messages (ADR 0092 § 3).
    await line('sale_parti', 'chatter_theo', new Date(Date.now() - 30 * 86_400_000), {
      gross: 5000,
      fan: 'fan_test_02',
    });
    await test.admin.db.insert(schema.fans).values({
      id: newId(FanIdSchema),
      creatorId,
      platformAccountId: accountId,
      platformFanId: 'fan_test_02',
      displayName: 'Payeur parti',
    });
    const steering = async (who: 'owner' | 'manager', query = '') => {
      const answer = await server.inject({
        method: 'GET',
        url: `/v1/dashboard/agency/steering${query}`,
        headers: { origin: DASHBOARD_ORIGIN, cookie: cookies.get(who) },
      });
      expect(answer.statusCode, answer.body).toBe(200);
      return AgencySteeringSchema.parse(answer.json());
    };
    const owner = await steering('owner');
    expect(owner.today).toBe(calendarDayAt(new Date(), 'Europe/Paris'));
    expect(owner.creators).toEqual([{ creatorId, name: 'Nora' }]);
    // Today's sales less the refund of one of them; the ghost refund has no sale and counts in nothing.
    expect(owner.daily.todayMinor).toBe(6000);
    expect(owner.daily.targetMinor).toBeNull();
    expect(owner.daily.days).toHaveLength(30);
    expect(owner.traffic).toMatchObject({
      newSubscribers: 9,
      wrote: null,
      firstPurchase: 1,
      regular: 1,
      previous: { firstPurchase: 1, regular: 0 },
    });
    expect(owner.dependency).toMatchObject({
      payingFans: 1,
      topOneMinor: 8400,
      totalMinor: 8400,
      fansForEighty: 1,
    });
    expect(owner.dependency.lapsed).toEqual([
      {
        creatorId,
        fanName: 'Payeur parti',
        spentMinor: 5000,
        lastPurchaseDay: owner.daily.days[0] === undefined ? '' : shiftDayBy(owner.daily.days[0].day, -1),
        daysSince: 30,
        conversationId: null,
      },
    ]);
    // Never a platform id of a fan.
    expect(JSON.stringify(owner)).not.toContain('fan_test_');
    expect(await steering('manager')).toEqual(owner);
    expect((await steering('owner', `?creatorId=${creatorId}`)).daily.todayMinor).toBe(6000);
    for (const who of ['operator', 'chatter', 'creator'] as const) {
      const refused = await server.inject({
        method: 'GET',
        url: '/v1/dashboard/agency/steering',
        headers: { origin: DASHBOARD_ORIGIN, cookie: cookies.get(who) },
      });
      expect(refused.statusCode, who).toBe(403);
    }
  });

  it('never names a lapsed payer in care or with an open doubt on his age, one given back is named (Sécurité 21/11)', async () => {
    const long = new Date(Date.now() - 40 * 86_400_000);
    const payer = async (platformFanId: string, displayName: string) => {
      await line(`sale_${platformFanId}`, 'chatter_theo', long, { gross: 7000, fan: platformFanId });
      const fanId = newId(FanIdSchema);
      await test.admin.db
        .insert(schema.fans)
        .values({ id: fanId, creatorId, platformAccountId: accountId, platformFanId, displayName });
      const conversationId = newId(ConversationIdSchema);
      await test.admin.db.insert(schema.conversations).values({
        id: conversationId,
        creatorId,
        platformAccountId: accountId,
        fanId,
        platformConversationId: `conv_${platformFanId}`,
      });
      return conversationId;
    };
    const event = async (conversationId: string, seq: number, type: string, payload: object) =>
      test.admin.db.insert(schema.conversationEvents).values({
        id: newId(EventIdSchema),
        creatorId,
        conversationId,
        seq,
        type,
        payload: { conversationId, ...payload },
        actor: 'ai',
        correlationId: 'steering-withheld',
      });
    const care = await payer('fan_test_10', 'En soin');
    await test.admin.db
      .update(schema.conversations)
      .set({ careSince: new Date() })
      .where(eq(schema.conversations.id, care));
    const doubt = await payer('fan_test_11', 'Doute ouvert');
    await event(doubt, 1, 'handoff_requested', { cause: 'minor' });
    const lifted = await payer('fan_test_12', 'Rendu');
    await event(lifted, 1, 'handoff_requested', { cause: 'minor' });
    await event(lifted, 2, 'takeover_ended', {});
    const answer = await server.inject({
      method: 'GET',
      url: '/v1/dashboard/agency/steering',
      headers: { origin: DASHBOARD_ORIGIN, cookie: cookies.get('owner') },
    });
    expect(answer.statusCode, answer.body).toBe(200);
    const names = AgencySteeringSchema.parse(answer.json()).dependency.lapsed.map((one) => one.fanName);
    expect(names).toContain('Rendu');
    expect(names).not.toContain('En soin');
    expect(names).not.toContain('Doute ouvert');
  });

  it('gives the MCP the same figures by the same rule, a manager his list alone (supervision.reads, ADR 0026 § 1)', async () => {
    const reads = app.modules.supervision.reads;
    const reader = (who: Who, role: 'owner' | 'operator' | 'creator', creatorIds: readonly CreatorId[]) => ({
      userId: UserIdSchema.parse(users.get(who)),
      role,
      creatorIds,
    });
    // A creator out of the manager's list, with a sale of hers today.
    const other = newId(CreatorIdSchema);
    const otherAccount = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: other, nameKey: 'autre', displayName: 'Autre', timezone: 'Europe/Paris' });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: otherAccount, creatorId: other, platform: 'reveal', handle: 'autre_test' });
    await test.admin.db.insert(schema.salesFeedModels).values({
      platform: 'reveal',
      platformModelId: 'model_test_02',
      platformAccountId: otherAccount,
      creatorId: other,
    });
    position += 1;
    await test.admin.db.insert(schema.platformSales).values({
      id: newId(SalesLineIdSchema),
      creatorId: other,
      platformAccountId: otherAccount,
      platform: 'reveal',
      platformSaleId: 'sale_other',
      event: 'sale',
      saleType: 'tip',
      status: 'paid',
      occurredAt: new Date(Math.max(Date.now() - 60_000, parisMidnight(new Date()) + 1000)),
      platformModelId: 'model_test_02',
      platformChatterId: null,
      platformFanId: 'fan_test_02',
      currency: 'EUR',
      grossInclVatMinor: 9000,
      grossExclVatMinor: 7500,
      netMinor: 6000,
      agencyMinor: 2250,
      creatorMinor: 3750,
      position: String(position).padStart(6, '0'),
      inputsHash: 'hash-sale_other-sale',
    });

    const screen = await agency('owner');
    const owner = await reads.agencyInsights(reader('owner', 'owner', []), 'day');
    expect(owner).toEqual(screen);
    expect(owner?.creators.map((one) => one.creatorId).sort()).toEqual([creatorId, other].sort());

    // The manager reads his list alone: the other creator's sale is in no figure of his.
    const manager = await reads.agencyInsights(
      reader('manager', 'operator', [creatorId, unlinkedCreatorId]),
      'day',
    );
    expect(manager).toEqual(await agency('manager'));
    expect(manager?.creators).toEqual([{ creatorId, name: 'Nora' }]);
    expect(manager?.totals.current.revenueMinor).toBe(6000);
    expect(JSON.stringify(manager)).not.toContain(other);

    // Whoever the screen refuses gets nothing, not even an empty answer.
    expect(await reads.agencyInsights(reader('chatter', 'operator', [creatorId]), 'day')).toBeNull();
    expect(await reads.agencyInsights(reader('operator', 'operator', [creatorId]), 'day')).toBeNull();
    expect(await reads.agencyInsights(reader('creator', 'creator', [creatorId]), 'day')).toBeNull();
  });
});
