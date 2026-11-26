import {
  CreatorIdSchema,
  CustomOrderListSchema,
  CustomOrderViewSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
  type FanId,
  type OpenCustomOrder,
} from '@impera/contracts';
import { eq, schema, withAdmin, withTenant } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { customOrderTurn } from '../modules/custom-orders';
import { createDrizzleCustomOrderStore } from '../modules/custom-orders/infra/db/order-store';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const orderStore = createDrizzleCustomOrderStore();

/**
 * His custom orders as the agency reads and answers them (ADR 0159 § A.3): the owner and a manager who follows her
 * read; the owner alone enters her yes at a price or her no, then each step up to delivery. Invented people, creators,
 * fans and prices only (ADR 0010).
 */
describe('/v1/creators/:creatorId/custom-orders', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  let fan: FanId;
  let counter = 0;
  const cookies: Record<'owner' | 'manager' | 'chatter' | 'nora', string> = {
    owner: '',
    manager: '',
    chatter: '',
    nora: '',
  };

  const call = (method: 'GET' | 'POST', path: string, who: keyof typeof cookies, body?: object) =>
    server.inject({
      method,
      url: `/v1/creators/${path}`,
      headers: { cookie: cookies[who], origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(server, email, PASSWORD) };
  }

  /** The agent's turn opens his order and sends her the card (format video, every essential box filled). */
  async function cardReady(): Promise<string> {
    counter += 1;
    const order: OpenCustomOrder | null = null;
    const turn = customOrderTurn({
      asksForService: true,
      reading: { format: 'video', supplements: [], minutes: 3, details: { what: 'test', when: 'test' } },
      order,
      stop: 'none',
      chatterOnShift: false,
      grid: null,
    });
    await withTenant(test.app.db, nora, (tx) =>
      orderStore.record(tx, {
        creatorId: nora,
        fanId: fan,
        inboundMessageId: `m-${String(counter)}`,
        turn,
        at: new Date(),
      }),
    );
    const listed = CustomOrderListSchema.parse((await call('GET', `${nora}/custom-orders`, 'owner')).json());
    const open = listed.orders.find((one) => one.state === 'awaiting_creator');
    if (open === undefined) throw new Error('no card');
    return open.id;
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
    ines = newId(CreatorIdSchema);
    for (const [id, label] of [
      [nora, 'Nora'],
      [ines, 'Ines'],
    ] as const)
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: 'Europe/Paris' });
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.owner = await signIn(server, 'owner@example.test', PASSWORD);
    for (const [who, teamRole] of [
      ['manager', 'manager'],
      ['chatter', 'chatter'],
    ] as const) {
      const member = await account(`${who}@example.test`, { role: 'operator', creatorIds: [nora, ines] });
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId: member.userId,
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${who}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
      cookies[who] = member.cookie;
    }
    cookies.nora = (await account('nora@example.test', { role: 'creator', creatorIds: [nora] })).cookie;
    // An invented fan of Nora and his order, read by the agent's turn (ADR 0010).
    const accountId = newId(PlatformAccountIdSchema);
    fan = newId(FanIdSchema);
    await withAdmin(test.admin.db, async (tx) => {
      await tx
        .insert(schema.platformAccounts)
        .values({ id: accountId, creatorId: nora, platform: 'reveal', handle: 'nora-demo' });
      await tx.insert(schema.fans).values({
        id: fan,
        creatorId: nora,
        platformAccountId: accountId,
        platformFanId: 'fan-1',
        displayName: 'Basile',
      });
    });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('the owner and a manager who follows her read the card; a chatter and her own account read nothing', async () => {
    const id = await cardReady();
    for (const who of ['owner', 'manager'] as const) {
      const response = await call('GET', `${nora}/custom-orders`, who);
      expect(response.statusCode, who).toBe(200);
      const [first] = CustomOrderListSchema.parse(response.json()).orders;
      expect(first).toMatchObject({ id, fanName: 'Basile', state: 'awaiting_creator', priceMinor: null });
      expect(first?.card).toMatchObject({ format: 'video', to: 'creator' });
    }
    expect((await call('GET', `${nora}/custom-orders`, 'chatter')).statusCode).toBe(404);
    expect((await call('GET', `${nora}/custom-orders`, 'nora')).statusCode).toBe(403);
  });

  it('her yes at a price sets half of a video as the deposit, then received, then delivered', async () => {
    const id = await cardReady();
    expect(
      (
        await call('POST', `${nora}/custom-orders/${id}/decision`, 'manager', {
          decision: 'yes',
          priceMinor: 5000,
        })
      ).statusCode,
    ).toBe(403);
    const yes = await call('POST', `${nora}/custom-orders/${id}/decision`, 'owner', {
      decision: 'yes',
      priceMinor: 5000,
    });
    expect(yes.statusCode).toBe(200);
    expect(CustomOrderViewSchema.parse(yes.json())).toMatchObject({
      state: 'creator_yes',
      priceMinor: 5000,
      depositMinor: 2500,
    });
    // Answered once: a second answer is refused, not applied.
    expect(
      (await call('POST', `${nora}/custom-orders/${id}/decision`, 'owner', { decision: 'no' })).statusCode,
    ).toBe(409);
    const paid = await call('POST', `${nora}/custom-orders/${id}/advance`, 'owner', { to: 'deposit_paid' });
    expect(CustomOrderViewSchema.parse(paid.json()).state).toBe('deposit_paid');
    const delivered = await call('POST', `${nora}/custom-orders/${id}/advance`, 'owner', { to: 'delivered' });
    expect(CustomOrderViewSchema.parse(delivered.json()).state).toBe('delivered');
    const active = CustomOrderListSchema.parse((await call('GET', `${nora}/custom-orders`, 'owner')).json());
    expect(active.orders.some((one) => one.id === id)).toBe(false);
    const all = CustomOrderListSchema.parse(
      (await call('GET', `${nora}/custom-orders?scope=all`, 'owner')).json(),
    );
    expect(all.orders.find((one) => one.id === id)?.state).toBe('delivered');
  });

  it('her no closes the order; a price out of bounds is refused', async () => {
    const id = await cardReady();
    expect(
      (
        await call('POST', `${nora}/custom-orders/${id}/decision`, 'owner', {
          decision: 'yes',
          priceMinor: 50,
        })
      ).statusCode,
    ).toBe(400);
    const no = await call('POST', `${nora}/custom-orders/${id}/decision`, 'owner', { decision: 'no' });
    expect(CustomOrderViewSchema.parse(no.json()).state).toBe('creator_no');
  });

  it('an order of another creator reads as none', async () => {
    const id = await cardReady();
    expect(
      (await call('POST', `${ines}/custom-orders/${id}/decision`, 'owner', { decision: 'no' })).statusCode,
    ).toBe(404);
    const listed = CustomOrderListSchema.parse((await call('GET', `${ines}/custom-orders`, 'owner')).json());
    expect(listed.orders).toEqual([]);
  });
});
