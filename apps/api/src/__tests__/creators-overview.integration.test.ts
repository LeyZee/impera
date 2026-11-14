import {
  ContentRequestIdSchema,
  CreatorIdSchema,
  CreatorsOverviewSchema,
  newId,
  PlatformAccountIdSchema,
  SalesLineIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type CreatorsOverview,
  type PlatformAccountId,
  type TeamMemberId,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const MINUTE = 60_000;

/**
 * `GET /v1/dashboard/creators` through the real app (« ok liste-créatrices », 06/11): the cards of the list of
 * Créatrices, each creator read in her tenant with the reader's scope. Everything is invented (ADR 0010).
 */
describe('GET /v1/dashboard/creators, the cards of the list of Créatrices', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerId: string;
  let nora: CreatorId;
  let lina: CreatorId;
  let archived: CreatorId;
  let noras: PlatformAccountId;
  let theo: TeamMemberId;
  type Who = 'owner' | 'manager' | 'chatter' | 'operator' | 'creator';
  const cookies = new Map<Who, string>();

  const get = (who: Who) =>
    server.inject({
      method: 'GET',
      url: '/v1/dashboard/creators',
      headers: { origin: DASHBOARD_ORIGIN, cookie: cookies.get(who) },
    });
  const cards = async (who: Who): Promise<CreatorsOverview['creators']> => {
    const answer = await get(who);
    expect(answer.statusCode, answer.body).toBe(200);
    return CreatorsOverviewSchema.parse(answer.json()).creators;
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

    nora = newId(CreatorIdSchema);
    lina = newId(CreatorIdSchema);
    archived = newId(CreatorIdSchema);
    noras = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.creators).values([
      { id: nora, nameKey: 'nora', displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: lina, nameKey: 'lina', displayName: 'Lina', timezone: 'Europe/Paris' },
      {
        id: archived,
        nameKey: 'ancienne',
        displayName: 'Ancienne',
        timezone: 'Europe/Paris',
        archivedAt: new Date(),
      },
    ]);
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: noras, creatorId: nora, platform: 'reveal', handle: 'nora_inventee' });
    await test.admin.db.insert(schema.salesFeedModels).values({
      platform: 'reveal',
      platformModelId: 'model_test_01',
      platformAccountId: noras,
      creatorId: nora,
    });

    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    }));
    cookies.set('owner', await signIn(server, 'owner@example.test', PASSWORD));
    // The manager is given Nora alone: Lina is never read for him.
    await member(await person('manager', 'operator', [nora, archived]), 'manager', 'Maya');
    theo = await member(await person('chatter', 'operator', [nora]), 'chatter', 'Théo');
    // An operator of the dashboard with no record in the team: his scope is his own.
    await person('operator', 'operator', [nora]);
    await person('creator', 'creator', [nora]);

    // A sale a minute ago: in her fortnight, whatever the day the test runs.
    await test.admin.db.insert(schema.platformSales).values({
      id: newId(SalesLineIdSchema),
      creatorId: nora,
      platformAccountId: noras,
      platform: 'reveal',
      platformSaleId: 'sale_test_01',
      event: 'sale',
      saleType: 'ppv',
      status: 'paid',
      occurredAt: new Date(Date.now() - MINUTE),
      platformModelId: 'model_test_01',
      platformChatterId: null,
      platformFanId: 'fan_test_01',
      currency: 'EUR',
      grossInclVatMinor: 1200,
      grossExclVatMinor: 1000,
      netMinor: 800,
      agencyMinor: 300,
      creatorMinor: 500,
      position: '000001',
      inputsHash: 'hash-sale_test_01',
    });

    // Théo is on shift on Nora now, until in two hours.
    const start = new Date(Math.floor(Date.now() / MINUTE) * MINUTE - 60 * MINUTE);
    const end = new Date(start.getTime() + 3 * 60 * MINUTE);
    await test.admin.db.insert(schema.shifts).values({
      id: newId(ShiftIdSchema),
      creatorId: nora,
      platformAccountId: noras,
      memberId: theo,
      startsAt: start,
      endsAt: end,
      createdBy: ownerId,
      updatedBy: ownerId,
    });

    // Two requests waiting on Nora, one cancelled.
    await test.admin.db.insert(schema.contentRequests).values([
      {
        id: newId(ContentRequestIdSchema),
        creatorId: nora,
        category: 'feed_video',
        dueOn: '2099-01-10',
        reason: 'Raison inventée',
        origin: 'agency',
        createdBy: ownerId,
      },
      {
        id: newId(ContentRequestIdSchema),
        creatorId: nora,
        category: 'feed_shoot',
        dueOn: '2000-01-05',
        reason: 'Raison inventée',
        origin: 'agency',
        createdBy: ownerId,
      },
      {
        id: newId(ContentRequestIdSchema),
        creatorId: nora,
        category: 'mass_dm',
        dueOn: '1999-01-01',
        reason: 'Raison inventée',
        origin: 'agency',
        state: 'cancelled',
        decidedAt: new Date(),
        createdBy: ownerId,
      },
    ]);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives the owner every creator not archived, her fortnight’s sales, who is on shift and what she owes', async () => {
    const list = await cards('owner');
    expect(list.map((card) => card.creatorId).toSorted()).toEqual([nora, lina].toSorted());
    const card = list.find((one) => one.creatorId === nora);
    expect(card?.mode).toBe('copilot');
    expect(card?.sales).toMatchObject({ sales: 1, refunds: 0, revenueMinor: 1200, usdLeftOut: false });
    expect(card?.onShift?.map((one) => [one.memberId, one.name])).toEqual([[theo, 'Théo']]);
    expect(card?.requests).toEqual({
      open: 2,
      next: { category: 'feed_shoot', dueOn: '2000-01-05', late: true },
    });
    // Never the fan.
    expect(JSON.stringify(list)).not.toMatch(/fan_test_01/u);

    const other = list.find((one) => one.creatorId === lina);
    expect(other).toMatchObject({ sales: null, onShift: [], requests: { open: 0, next: null } });
  });

  it('gives an active manager his creators only, archived ones left out', async () => {
    const list = await cards('manager');
    expect(list.map((card) => card.creatorId)).toEqual([nora]);
    expect(list[0]?.sales?.revenueMinor).toBe(1200);
    expect(list[0]?.requests?.open).toBe(2);
  });

  it('gives a reader whose scope is his own her mode alone, and a chatter no creator (ADR 0043 § 7)', async () => {
    expect(await cards('operator')).toEqual([
      { creatorId: nora, mode: 'copilot', sales: null, onShift: null, requests: null },
    ]);
    expect(await cards('chatter')).toEqual([]);
  });

  it('is closed to the creator and to whoever is not signed in', async () => {
    expect((await get('creator')).statusCode).toBe(403);
    const anonymous = await server.inject({
      method: 'GET',
      url: '/v1/dashboard/creators',
      headers: { origin: DASHBOARD_ORIGIN },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
